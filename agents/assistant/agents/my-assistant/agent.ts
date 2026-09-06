import { callable } from "agents";
import {
  Think,
  Session,
  defaultContextOverflowClassifier
} from "@cloudflare/think";
import type { WorkspaceFsLike } from "@cloudflare/shell";
import { createCompactFunction } from "agents/experimental/memory/utils";
import type {
  TurnContext,
  TurnConfig,
  ChatResponseResult,
  ToolCallContext,
  ToolCallResultContext,
  StepContext
} from "@cloudflare/think";
import { tool, generateText } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { AssistantDirectory } from "../../agent";
import { SharedWorkspace } from "../../shared-workspace";
import type { AgentConfig, UsageSummary } from "../../types";
import {
  normalizeAgentConfig,
  resolveFamilyModel
} from "../../../model-provider";
import {
  DEFAULT_MODEL_ROUTE_ID,
  getModelRoute,
  getRoutePricing,
  type ModelRoute
} from "../../../../shared/model-catalog";
import type { HeyiweiProviderStatus } from "../../../../src/provider-status";
import type {
  FinalReflection,
  InitialAssessment,
  StudyEvent,
  StudyStage,
  StudyState
} from "../../../../shared/study";
import { getMedicalCase, hasMedicalCase } from "../../../medical/cases";
import { buildStudyInstructions } from "../../../medical/study-prompts";

/**
 * 医学教学实验固定底层模型，学生端不能自行切换，避免模型差异成为混杂因素。
 */
const STUDY_MODEL_CONFIG: AgentConfig = {
  modelRouteId: DEFAULT_MODEL_ROUTE_ID,
  reasoningEffort: getModelRoute(DEFAULT_MODEL_ROUTE_ID).defaultReasoningEffort,
  persona: ""
};

/** 从 AI SDK 的 ModelMessage 中提取可记录的用户纯文本。 */
function modelMessageText(message: { role?: string; content?: unknown }): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const value = part as { type?: string; text?: unknown };
      return value.type === "text" && typeof value.text === "string"
        ? value.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

type EuropePmcResult = {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
};

// ── MyAssistant — one Think DO per chat (a facet of the directory) ────

export class MyAssistant extends Think<Env> {
  static options = {
    sendIdentityOnConnect: true
  };
  // Family AI 允许复杂任务一直做完：Think 会始终把 maxSteps 组合进
  // `stopWhen`，没有单独的“关闭步数上限”开关，因此这里把上限抬到 JS 的
  // 最大安全整数，实践上等价于不按 tool round 截断。正常 turn 仍会在模型
  // 给出最终答案、用户 Stop、真实错误或 recovery 终止时结束。
  override maxSteps = Number.MAX_SAFE_INTEGER;

  // 与“工具轮数”无关的死流保护：只有模型/工具链连续 3 分钟完全没有任何
  // UI stream chunk 时才判定 stalled，并交给 Think 的 durable recovery。
  // 这样不会再出现供应商连接挂死后无限 spinner，也不会误杀正常几十轮任务。
  override chatStreamStallTimeoutMs = 180_000;

  /**
   * Override Think's default per-chat workspace with a proxy into the
   * shared `AssistantDirectory.workspace`. This class field runs in the
   * subclass's synthetic constructor after `super(ctx, env)`, so by the
   * time Think's wrapped `onStart` fires its `!this.workspace` default-
   * init check, the shared proxy is already in place — Think never
   * creates a per-chat `Workspace` at all.
   *
   * Declared as `WorkspaceFsLike` (the wider interface from
   * `@cloudflare/shell`) rather than Think's `WorkspaceLike` so that
   * `createWorkspaceStateBackend(this.workspace)` in `getTools()` sees
   * the full filesystem surface it needs. `WorkspaceFsLike` is a strict
   * superset of `WorkspaceLike`, so Think's internals keep working.
   *
   * All workspace-aware code — the builtin tools from
   * `createWorkspaceTools`, lifecycle hooks, the `listWorkspaceFiles`
   * / `readWorkspaceFile` RPCs below, and codemode's `state.*` sandbox
   * API via `createWorkspaceStateBackend` — routes through this proxy
   * transparently.
   */
  override workspace: WorkspaceFsLike = new SharedWorkspace(() =>
    this.parentAgent(AssistantDirectory)
  );

  getModel() {
    return resolveFamilyModel(this.env, STUDY_MODEL_CONFIG).model;
  }

  // Recover from a turn that overflows the context window mid-flight: compaction
  // (configured in configureSession below) is only checked between turns, so a
  // long, tool-heavy turn can grow past the window before the next check. With
  // `reactive` on, such a turn is compacted and re-run instead of dying.
  override contextOverflow = {
    reactive: true,
    // Codex GPT-5.6 当前有效窗口约 258K。Think 会在前一步模型真实上报的
    // inputTokens 接近 90% 时主动压缩，避免一个长 tool loop 在 turn 中途才撞墙。
    proactive: { maxInputTokens: 258_400 }
  };

  // Think ships no provider-specific error matching — teach it which errors are
  // context-window overflows. The bundled defaultContextOverflowClassifier
  // covers the common providers; assign it directly, or wrap it to add your own
  // categories.
  override classifyChatError = defaultContextOverflowClassifier;

  configureSession(session: Session) {
    const persona =
      normalizeAgentConfig(this.getConfig<AgentConfig>()).persona ||
      "You are a capable family AI assistant. You have OpenAI Responses web search for current information, a persistent shared workspace with sandboxed Bash, stateless browser Quick Actions, fetch_url for known public URLs, persistent memory, searchable context, skills, MCP tools, and approval-gated tools. Prefer provider web search for open-ended current-information questions; use fetch_url or browser tools when the user provides a specific URL or rendered page.";

    return session
      .withContext("soul", {
        provider: {
          get: async () =>
            `${persona}

Be concise. Prefer short, direct answers over lengthy explanations.
Use the direct workspace tools for file operations. For reading a known URL or API, prefer the \`fetch_url\` tool — it is a fast, read-only HTTP GET over any public URL, and large responses spill to the workspace. For rendered pages, link discovery, or AI extraction, use the one-shot Quick Action tools — \`browser_markdown\` to read a page, \`browser_extract\` to pull structured data, \`browser_links\` to list links, and \`browser_scrape\` to grab elements.
When you learn something about the user or their project, save it to memory.`
        }
      })
      .withContext("memory", {
        description:
          "Key facts about the user, their preferences, project context, and decisions made during conversation. Update when you learn something that would be useful in future turns.",
        maxTokens: 2000
      })
      .onCompaction(
        createCompactFunction({
          summarize: (prompt) =>
            generateText({ model: this.resolveModel(), prompt }).then(
              (r) => r.text
            )
        })
      )
      // 原官方示例的 50K 只是演示值；对 Codex 272K 会造成极其频繁、昂贵的
      // 重复摘要。V0 在约 230K 才触发 Think 的非破坏性 fallback compaction。
      // Codex remote_compaction_v2 会继续单独探测；在确认其输出能安全映射进
      // Think Session 之前，不把 opaque compaction item 假装成普通文本摘要。
      .compactAfter(230_000)
      .withContext("knowledge", {
        description:
          "Searchable knowledge base. Index useful information with set_context and retrieve it later with search_context.",
        provider: new AgentSearchProvider(this)
      })
      .withCachedPrompt();
  }

  getTools(): ToolSet {
    const resolved = resolveFamilyModel(this.env, this.getConfig<AgentConfig>());

    return {
      // Codex / OpenAI Responses 路由把 Web Search 作为当前主模型同一次
      // `streamText` 的 provider-executed hosted tool。模型自己决定何时调用，
      // `web_search_call`、reasoning 与 sources 都留在原 turn 中；不会再额外
      // 启动一次模型请求，因此不会平白重复系统提示词和上下文 token。
      ...(resolved.route.capabilities.nativeWebSearch && resolved.openaiProvider
        ? {
            web_search: resolved.openaiProvider.tools.webSearch({
              searchContextSize: "medium",
              externalWebAccess: true
            })
          }
        : {}),

      // Workers Free 目前不能部署 Worker Loader / Dynamic Workers。
      // 因此这里把 Think 的共享 Workspace 工具直接暴露给模型：文件仍然持久化、
      // 仍然跨聊天共享，只是不再经过 Code Mode 的动态沙箱执行层。
      ...createWorkspaceTools(this.workspace),

      // 保留一个独立的审批工具，用来继续试玩 Think 的 durable approval 流程；
      // 它不依赖 Dynamic Workers，因此免费计划也能完整体验批准 / 拒绝。
      sendAnnouncement: tool({
        description:
          "Send an announcement to the team channel. Requires human approval before it goes out.",
        inputSchema: z.object({
          message: z.string().describe("The announcement text")
        }),
        needsApproval: true,
        execute: async ({ message }) => ({
          sent: true,
          message
        })
      }),

      // Stateless one-shot browsing (no CDP session, no sandbox): read a page
      // as Markdown, extract structured data with AI, list links, or scrape
      // elements. Complements the interactive `cdp.*` inside `execute` above —
      // the model picks Quick Actions for simple reads and `execute` for
      // multi-step automation. Shares the same `BROWSER` binding.
      ...createQuickActionTools({ browser: this.env.BROWSER }),

      getWeather: tool({
        description: "Get the current weather for a city",
        inputSchema: z.object({
          city: z.string().describe("City name")
        }),
        execute: async ({ city }) => {
          const conditions = ["sunny", "cloudy", "rainy", "snowy"];
          const temp = Math.floor(Math.random() * 30) + 5;
          return {
            city,
            temperature: temp,
            condition:
              conditions[Math.floor(Math.random() * conditions.length)],
            unit: "celsius"
          };
        }
      }),

      getUserTimezone: tool({
        description:
          "Get the user's timezone from their browser. Use this when you need to know the user's local time.",
        inputSchema: z.object({})
      }),

      calculate: tool({
        description:
          "Perform a math calculation. Requires approval for large numbers (over 1000).",
        inputSchema: z.object({
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
          operator: z.enum(["+", "-", "*", "/"]).describe("Arithmetic operator")
        }),
        needsApproval: async ({ a, b }) =>
          Math.abs(a) > 1000 || Math.abs(b) > 1000,
        execute: async ({ a, b, operator }) => {
          const ops: Record<string, (x: number, y: number) => number> = {
            "+": (x, y) => x + y,
            "-": (x, y) => x - y,
            "*": (x, y) => x * y,
            "/": (x, y) => x / y
          };
          if (operator === "/" && b === 0) {
            return { error: "Division by zero" };
          }
          return {
            expression: `${a} ${operator} ${b}`,
            result: ops[operator](a, b)
          };
        }
      })
    };
  }

  async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    // Splice the directory's shared MCP tools into this turn. Think
    // merges `config.tools` additively on top of the base tool set, so
    // whatever tools we return here join `workspace` / `extensions` /
    // `execute` / builtins on every turn. The proxy waits for any
    // in-progress MCP connections to settle (5s default) before
    // returning, so a chat that just woke up still sees tools from
    // servers that are mid-handshake.
    const mcpTools = await this.sharedMcp.getAITools();
    const resolved = resolveFamilyModel(
      this.env,
      this.getConfig<AgentConfig>()
    );

    console.log(
      `Turn starting: route=${resolved.route.routeId}, effort=${resolved.reasoningEffort}, ${Object.keys(ctx.tools).length} base tools + ${Object.keys(mcpTools).length} MCP tools, continuation=${ctx.continuation}`
    );

    const isCodex = resolved.route.backendProtocol === "codex-subscription";
    // Codex 的默认缓存域与 session 对齐。把 route 加进去是为了在用户切换
    // 分组/模型时主动开启新的缓存域，避免不同后池复用同一 key；切回来时仍能
    // 回到原来的稳定缓存域。
    const promptCacheKey = `family-ai:${this.name}:${resolved.route.routeId}`;

    return {
      model: resolved.model,
      tools: mcpTools,
      // Sub2API 会用显式会话信号做 sticky scheduling。让 session/thread/cache
      // 三者从同一事实来源派生，避免同一聊天每轮被随机分到不同 Codex 账号，
      // 否则即使 prompt 前缀完全相同也不可能稳定命中缓存。
      headers: isCodex
        ? {
            originator: "codex_cli_rs",
            "session-id": promptCacheKey,
            "thread-id": promptCacheKey,
            "x-client-request-id": promptCacheKey,
            "OpenAI-Beta": "responses=experimental"
          }
        : undefined,
      providerOptions: isCodex
        ? {
            openai: {
              reasoningEffort: resolved.reasoningEffort,
              reasoningSummary: "auto",
              store: false,
              promptCacheKey,
              // Think 会把 provider metadata 随消息保存；显式请求 encrypted
              // reasoning 后，后续同一路由可原样回放，而不是丢失 Codex 的
              // reasoning 状态并迫使模型重新推理。
              include: ["reasoning.encrypted_content"]
            }
          }
        : {
            // DeepSeek V4 使用专用 provider。`none` 明确关闭 thinking；其余档位
            // 直接走 V4 的 low/high/max reasoning_effort，并由 provider 负责
            // reasoning_content 的流式展示与多轮回递。
            deepseek: {
              thinking: {
                type: resolved.reasoningEffort === "none" ? "disabled" : "enabled"
              },
              ...(resolved.reasoningEffort === "none"
                ? {}
                : { reasoningEffort: resolved.reasoningEffort })
            }
          }
    };
  }

  beforeToolCall(ctx: ToolCallContext): void {
    console.log(`Tool call: ${ctx.toolName}`, JSON.stringify(ctx.input));
  }

  afterToolCall(ctx: ToolCallResultContext): void {
    if (ctx.success) {
      const resultSize = JSON.stringify(ctx.output).length;
      console.log(
        `Tool result: ${ctx.toolName} (${resultSize} bytes, ${ctx.durationMs}ms)`
      );
    } else {
      console.error(
        `Tool failed: ${ctx.toolName} (${ctx.durationMs}ms)`,
        ctx.error
      );
    }
  }

  private async getLiveBillingMultiplier(
    route: ModelRoute
  ): Promise<number | undefined> {
    if (route.providerId !== "heyiwei") return undefined;

    try {
      const id = this.env.ProviderStatus.idFromName("global");
      const response = await this.env.ProviderStatus.get(id).fetch(
        "https://provider-status/heyiwei?range=90m"
      );
      if (!response.ok) return undefined;

      const status = (await response.json()) as HeyiweiProviderStatus;
      const multiplier = status.groups.find(
        (group) => group.groupId === route.groupId
      )?.multiplier;
      return typeof multiplier === "number" && Number.isFinite(multiplier)
        ? multiplier
        : undefined;
    } catch (error) {
      console.warn("[MyAssistant] live billing multiplier unavailable", error);
      return undefined;
    }
  }

  async onStepFinish(ctx: StepContext): Promise<void> {
    if (!ctx.usage) return;

    const config = normalizeAgentConfig(this.getConfig<AgentConfig>());
    const route = getModelRoute(config.modelRouteId);
    const liveMultiplier = await this.getLiveBillingMultiplier(route);
    const pricing = getRoutePricing(route, new Date(), liveMultiplier);

    const inputTokens = ctx.usage.inputTokens ?? 0;
    const cachedInputTokens = ctx.usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const noCacheTokens =
      ctx.usage.inputTokenDetails?.noCacheTokens ??
      Math.max(0, inputTokens - cachedInputTokens);
    const outputTokens = ctx.usage.outputTokens ?? 0;
    const reasoningTokens = ctx.usage.outputTokenDetails?.reasoningTokens ?? 0;
    const totalTokens = ctx.usage.totalTokens ?? inputTokens + outputTokens;
    const estimatedCostUsd = pricing
      ? (noCacheTokens * pricing.inputPerMillionUsd +
          cachedInputTokens * pricing.cachedInputPerMillionUsd +
          outputTokens * pricing.outputPerMillionUsd) /
        1_000_000
      : null;
    const createdAt = Date.now();

    // 每个聊天子 Agent 拥有自己的 SQLite，因此 ledger 天然按聊天隔离。
    this.sql`CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      route_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cached_input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_usd REAL
    )`;

    this.sql`INSERT INTO usage_ledger (
      created_at,
      route_id,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      total_tokens,
      cost_usd
    ) VALUES (
      ${createdAt},
      ${route.routeId},
      ${inputTokens},
      ${cachedInputTokens},
      ${outputTokens},
      ${reasoningTokens},
      ${totalTokens},
      ${estimatedCostUsd}
    )`;

    console.log(
      `Step finished (${ctx.finishReason}): ${inputTokens}in/${outputTokens}out, route=${route.routeId}, cost=${estimatedCostUsd ?? "unknown"}`
    );
  }

  async onChatResponse(result: ChatResponseResult): Promise<void> {
    console.log(`Turn ${result.status}: ${result.message.parts.length} parts`);

    // Update the sidebar preview on the parent directory. Best-effort —
    // the chat should still function if the RPC fails.
    const preview = result.message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("")
      .slice(0, 120);
    if (!preview) return;

    try {
      const directory = await this.parentAgent(AssistantDirectory);
      await directory.recordChatTurn(this.name, preview);
    } catch (err) {
      console.warn("[MyAssistant] Failed to update directory preview:", err);
    }
  }

  // No `onStart` override: MCP is shared from the parent directory
  // (see `AssistantDirectory.onStart`), schedules live on the parent,
  // and everything per-chat (workspace, extensions, session config)
  // is wired up by Think's own base `onStart` via class fields.

  /**
   * Called by `AssistantDirectory.dailySummary()` on the daily cron.
   * Queues a proactive user message so the model produces a summary on
   * the next connection/turn. Runs as an RPC from the parent — no
   * model call happens here.
   *
   * Deliberately NOT `@callable()` — parent→child DO RPC doesn't need
   * the decorator, and exposing this to browsers would let a client
   * inject a "summarize recent work" prompt on demand.
   */
  async postDailySummaryPrompt() {
    await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [
          {
            type: "text",
            text: "Generate a brief summary of what we worked on recently. Check the workspace for any files and summarize the current state of things."
          }
        ]
      }
    ]);
  }

  // `addServer` / `removeServer` used to live here as `@callable`
  // wrappers around `this.addMcpServer` / `this.removeMcpServer`. They
  // moved to `AssistantDirectory` so every chat shares one MCP server
  // list. The client now calls the directory directly via `useChats()`;
  // see `src/use-chats.ts`.

  @callable()
  async getResponseVersions(userMessageId: string) {
    return this.session.getBranches(userMessageId);
  }

  @callable()
  updateConfig(config: AgentConfig) {
    // 浏览器传来的 routeId / effort 必须经过共享目录重新校验，不能直接信任。
    const normalized = normalizeAgentConfig(config);
    this.configure<AgentConfig>(normalized);
    return normalized;
  }

  @callable()
  currentConfig() {
    return normalizeAgentConfig(this.getConfig<AgentConfig>());
  }

  @callable()
  getUsageSummary(): UsageSummary {
    const config = normalizeAgentConfig(this.getConfig<AgentConfig>());

    this.sql`CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      route_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cached_input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_usd REAL
    )`;

    const [totals] = this.sql<{
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      total_tokens: number;
      cost_usd: number | null;
      unknown_cost_steps: number;
    }>`SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      SUM(cost_usd) AS cost_usd,
      COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unknown_cost_steps
    FROM usage_ledger`;

    const [latest] = this.sql<{
      route_id: string;
      input_tokens: number;
      created_at: number;
    }>`SELECT route_id, input_tokens, created_at
       FROM usage_ledger
       ORDER BY id DESC
       LIMIT 1`;

    const route = getModelRoute(latest?.route_id ?? config.modelRouteId);
    const contextTokens = latest?.input_tokens ?? 0;

    return {
      modelRouteId: route.routeId,
      contextTokens,
      // Codex 路由按 95% effective window 画上下文圆环，避免 UI 到 100%
      // 才发现模型其实已经进入客户端预留的压缩/保护区。
      contextWindow: route.effectiveContextWindow,
      contextPercent: Math.min(
        100,
        route.effectiveContextWindow > 0
          ? (contextTokens / route.effectiveContextWindow) * 100
          : 0
      ),
      inputTokens: totals?.input_tokens ?? 0,
      cachedInputTokens: totals?.cached_input_tokens ?? 0,
      outputTokens: totals?.output_tokens ?? 0,
      reasoningTokens: totals?.reasoning_tokens ?? 0,
      totalTokens: totals?.total_tokens ?? 0,
      estimatedCostUsd:
        (totals?.unknown_cost_steps ?? 0) > 0 ? null : (totals?.cost_usd ?? 0),
      updatedAt: latest?.created_at ?? null
    };
  }

  @callable()
  async listWorkspaceFiles(path: string = "/") {
    try {
      return await this.workspace.readDir(path);
    } catch {
      return [];
    }
  }

  @callable()
  async readWorkspaceFile(path: string) {
    try {
      return await this.workspace.readFile(path);
    } catch {
      return null;
    }
  }

  @callable()
  async listExtensions() {
    if (!this.extensionManager) return [];
    return this.extensionManager.list();
  }
}
