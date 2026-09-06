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
import {
  buildStudyBaseInstructions,
  buildStudyStageDirective
} from "../../../medical/study-prompts";

/**
 * 医学教学实验固定底层模型，学生端不能自行切换，避免模型差异成为混杂因素。
 */
const STUDY_MODEL_CONFIG: AgentConfig = {
  modelRouteId: "deepseek:official:deepseek-v4-flash",
  reasoningEffort: "high",
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
  abstractText?: string;
  isOpenAccess?: string;
  inEPMC?: string;
  hasPDF?: string;
  fullTextUrlList?: {
    fullTextUrl?: Array<{
      availability?: string;
      availabilityCode?: string;
      documentStyle?: string;
      site?: string;
      url?: string;
    }>;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, value) =>
      String.fromCodePoint(Number(value))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) =>
      String.fromCodePoint(Number.parseInt(value, 16))
    );
}

function xmlToPlainText(xml: string): string {
  const withBreaks = xml
    .replace(/<\/(?:p|sec|title|abstract|list-item|table-wrap|fig|caption)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");
  return decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const INITIAL_ASSESSMENT_SCHEMA = z.object({
  primaryDiagnosis: z.string().trim().min(1).max(500),
  differentials: z.string().trim().min(1).max(3000),
  reasoning: z.string().trim().min(1).max(5000),
  confidence: z.number().min(0).max(100)
});

const FINAL_REFLECTION_SCHEMA = z.object({
  finalDiagnosis: z.string().trim().min(1).max(500),
  revisedReasoning: z.string().trim().min(1).max(5000),
  evidenceImpact: z.string().trim().min(1).max(5000),
  cognitiveBiasReflection: z.string().trim().min(1).max(5000),
  reflection: z.string().trim().min(1).max(5000),
  confidence: z.number().min(0).max(100)
});

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
   * Europe PMC 外连只在工具执行器层做并发整形，不限制模型可以搜索多少次。
   * Cloudflare 当前每个 invocation 最多允许 6 条“等待响应头”的外连；这里把
   * 医学证据工具自己的并发压到 3，给模型流、其他 Worker 子请求留出余量。
   * 超出并发的调用会进入队列，拿到槽位后再随机等待约 1~2 秒，避免瞬时尖峰。
   */
  private evidenceFetchActive = 0;
  private readonly evidenceFetchWaiters: Array<(queued: boolean) => void> = [];

  private async acquireEvidenceFetchSlot(): Promise<boolean> {
    if (this.evidenceFetchActive < 3) {
      this.evidenceFetchActive += 1;
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.evidenceFetchWaiters.push(resolve);
    });
  }

  private releaseEvidenceFetchSlot(): void {
    const next = this.evidenceFetchWaiters.shift();
    if (next) {
      // 槽位直接转交给队首 waiter，active 数量保持不变。
      next(true);
      return;
    }
    this.evidenceFetchActive = Math.max(0, this.evidenceFetchActive - 1);
  }

  private async withEvidenceFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
    const queued = await this.acquireEvidenceFetchSlot();
    if (queued) {
      await sleep(1000 + Math.floor(Math.random() * 1000));
    }
    try {
      return await fn();
    } finally {
      this.releaseEvidenceFetchSlot();
    }
  }

  private async fetchEuropePmc(url: URL, accept: string): Promise<Response> {
    const maxAttempts = 4;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await this.withEvidenceFetchSlot(() =>
          fetch(url, { headers: { Accept: accept } })
        );

        if (response.ok) return response;

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxAttempts - 1) return response;

        response.body?.cancel();
        const retryAfter = Number(response.headers.get("Retry-After"));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 750 * 2 ** attempt + Math.floor(Math.random() * 500);
        await sleep(backoffMs);
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts - 1) throw error;
        await sleep(750 * 2 ** attempt + Math.floor(Math.random() * 500));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Europe PMC 请求失败");
  }

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

  /**
   * 建立每个病例训练自己的状态与事件表。
   *
   * Think 本身会持久化完整消息；这里额外保存“研究语义事件”，是因为论文分析
   * 需要稳定字段，而不能以后再从自然语言聊天里猜哪一条是初判、哪一条是反思。
   */
  private ensureStudyTables(): void {
    this.sql`CREATE TABLE IF NOT EXISTS study_state (
      id INTEGER PRIMARY KEY,
      case_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      initial_assessment_json TEXT,
      final_reflection_json TEXT
    )`;

    this.sql`CREATE TABLE IF NOT EXISTS study_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      stage TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )`;
  }

  /**
   * 父 Directory 创建子 Agent 后调用一次。方法故意不加 `@callable()`：
   * 浏览器没有权限给已经存在的训练重新绑定病例。
   */
  async initializeStudy(caseId: string): Promise<StudyState> {
    if (!hasMedicalCase(caseId)) {
      throw new Error(`未知医学教学病例：${caseId}`);
    }

    this.ensureStudyTables();
    const existing = this.getStudyStateRow();
    if (existing) {
      if (existing.case_id !== caseId) {
        throw new Error("训练会话已经绑定其他病例，不能重新绑定");
      }
      return this.rowToStudyState(existing);
    }

    const now = Date.now();
    this.sql`INSERT INTO study_state (
      id, case_id, stage, started_at, updated_at,
      initial_assessment_json, final_reflection_json
    ) VALUES (1, ${caseId}, ${"history"}, ${now}, ${now}, NULL, NULL)`;

    this.appendStudyEvent("study_started", "history", { caseId });
    return this.getStudyStateInternal();
  }

  private getStudyStateRow() {
    this.ensureStudyTables();
    const [row] = this.sql<{
      case_id: string;
      stage: StudyStage;
      started_at: number;
      updated_at: number;
      initial_assessment_json: string | null;
      final_reflection_json: string | null;
    }>`SELECT
      case_id,
      stage,
      started_at,
      updated_at,
      initial_assessment_json,
      final_reflection_json
    FROM study_state
    WHERE id = 1`;
    return row;
  }

  private rowToStudyState(row: NonNullable<ReturnType<MyAssistant["getStudyStateRow"]>>): StudyState {
    return {
      caseId: row.case_id,
      stage: row.stage,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      initialAssessment: row.initial_assessment_json
        ? (JSON.parse(row.initial_assessment_json) as InitialAssessment)
        : undefined,
      finalReflection: row.final_reflection_json
        ? (JSON.parse(row.final_reflection_json) as FinalReflection)
        : undefined
    };
  }

  /**
   * 所有模型 turn 都要求会话已经初始化。理论上父 Directory 会先 initialize，
   * 这里再做一次防御性兜底，避免开发阶段直接访问子路由导致空状态崩溃。
   */
  private getStudyStateInternal(): StudyState {
    this.ensureStudyTables();
    let row = this.getStudyStateRow();
    if (!row) {
      const now = Date.now();
      this.sql`INSERT INTO study_state (
        id, case_id, stage, started_at, updated_at,
        initial_assessment_json, final_reflection_json
      ) VALUES (1, ${"thyrotoxicosis-001"}, ${"history"}, ${now}, ${now}, NULL, NULL)`;
      this.appendStudyEvent("study_started_fallback", "history", {
        caseId: "thyrotoxicosis-001"
      });
      row = this.getStudyStateRow();
    }
    if (!row) throw new Error("无法初始化医学教学训练状态");
    return this.rowToStudyState(row);
  }

  private appendStudyEvent(
    eventType: string,
    stage: StudyStage,
    payload: unknown
  ): void {
    this.ensureStudyTables();
    let payloadJson = "{}";
    try {
      payloadJson = JSON.stringify(payload ?? null);
    } catch {
      payloadJson = JSON.stringify({ serializationError: true });
    }
    this.sql`INSERT INTO study_events (
      created_at, event_type, stage, payload_json
    ) VALUES (${Date.now()}, ${eventType}, ${stage}, ${payloadJson})`;
  }

  private listStudyEventsInternal(): StudyEvent[] {
    this.ensureStudyTables();
    const rows = this.sql<{
      id: number;
      created_at: number;
      event_type: string;
      stage: StudyStage;
      payload_json: string;
    }>`SELECT id, created_at, event_type, stage, payload_json
       FROM study_events
       ORDER BY id ASC`;

    return rows.map((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = { raw: row.payload_json };
      }
      return {
        id: row.id,
        createdAt: row.created_at,
        eventType: row.event_type,
        stage: row.stage,
        payload
      };
    });
  }

  private async transitionStudyStage(
    expected: StudyStage,
    next: StudyStage,
    eventType: string,
    payload: unknown
  ): Promise<StudyState> {
    const current = this.getStudyStateInternal();
    if (current.stage !== expected) {
      throw new Error(
        `当前阶段为 ${current.stage}，不能执行要求 ${expected} 的操作`
      );
    }

    const now = Date.now();
    this.sql`UPDATE study_state
      SET stage = ${next}, updated_at = ${now}
      WHERE id = 1`;
    this.appendStudyEvent(eventType, next, payload);

    const directory = await this.parentAgent(AssistantDirectory);
    await directory.recordStudyStage(this.name, next);
    return this.getStudyStateInternal();
  }

  @callable()
  getStudyState(): StudyState {
    return this.getStudyStateInternal();
  }

  @callable()
  async submitInitialAssessment(input: InitialAssessment): Promise<StudyState> {
    const assessment = INITIAL_ASSESSMENT_SCHEMA.parse(input);
    const current = this.getStudyStateInternal();
    if (current.stage !== "history") {
      throw new Error("初步判断只能在问诊实践阶段提交一次");
    }

    const now = Date.now();
    const payloadJson = JSON.stringify(assessment);
    this.sql`UPDATE study_state
      SET stage = ${"clinical_feedback"},
          updated_at = ${now},
          initial_assessment_json = ${payloadJson}
      WHERE id = 1`;
    this.appendStudyEvent("initial_assessment_submitted", "clinical_feedback", assessment);

    const directory = await this.parentAgent(AssistantDirectory);
    await directory.recordStudyStage(this.name, "clinical_feedback");
    return this.getStudyStateInternal();
  }

  @callable()
  advanceToEvidence(): Promise<StudyState> {
    return this.transitionStudyStage(
      "clinical_feedback",
      "evidence",
      "evidence_stage_started",
      {}
    );
  }

  @callable()
  advanceToReflection(): Promise<StudyState> {
    return this.transitionStudyStage(
      "evidence",
      "reflection",
      "reflection_stage_started",
      {}
    );
  }

  @callable()
  async submitFinalReflection(input: FinalReflection): Promise<StudyState> {
    const reflection = FINAL_REFLECTION_SCHEMA.parse(input);
    const current = this.getStudyStateInternal();
    if (current.stage !== "reflection") {
      throw new Error("最终判断与反思只能在反思修订阶段提交一次");
    }

    const now = Date.now();
    const payloadJson = JSON.stringify(reflection);
    this.sql`UPDATE study_state
      SET stage = ${"completed"},
          updated_at = ${now},
          final_reflection_json = ${payloadJson}
      WHERE id = 1`;
    this.appendStudyEvent("final_reflection_submitted", "completed", reflection);

    const directory = await this.parentAgent(AssistantDirectory);
    await directory.recordStudyStage(this.name, "completed");
    return this.getStudyStateInternal();
  }

  @callable()
  exportStudyData() {
    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      chatId: this.name,
      state: this.getStudyStateInternal(),
      events: this.listStudyEventsInternal()
    };
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
    return session
      .withContext("soul", {
        provider: {
          get: async () => {
            const state = this.getStudyStateInternal();
            return buildStudyBaseInstructions(getMedicalCase(state.caseId));
          }
        }
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
      .withCachedPrompt();
  }

  getTools(): ToolSet {
    return {
      /**
       * Europe PMC 检索：返回 core metadata + 摘要 + OA 全文可用性。
       * 模型可以自由搜索任意次数；并发/退避由 fetchEuropePmc() 在执行层控制。
       */
      search_medical_evidence: tool({
        description:
          "Search real biomedical literature in Europe PMC. Returns metadata, abstracts, identifiers, and whether open-access full text can be read with read_medical_evidence.",
        inputSchema: z.object({
          query: z.string().min(2).describe("Biomedical literature query in English"),
          limit: z.number().int().min(1).max(8).default(5)
        }),
        execute: async ({ query, limit }) => {
          const url = new URL(
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
          );
          url.searchParams.set("query", query);
          url.searchParams.set("format", "json");
          url.searchParams.set("resultType", "core");
          url.searchParams.set("pageSize", String(limit));

          const response = await this.fetchEuropePmc(url, "application/json");
          if (!response.ok) {
            throw new Error(`Europe PMC 检索失败：HTTP ${response.status}`);
          }

          const payload = (await response.json()) as {
            hitCount?: number;
            resultList?: { result?: EuropePmcResult[] };
          };
          const results = (payload.resultList?.result ?? []).map((item) => ({
            title: item.title ?? "Untitled",
            authors: item.authorString ?? "",
            journal: item.journalTitle ?? "",
            year: item.pubYear ?? "",
            pmid: item.pmid ?? (item.source === "MED" ? item.id : undefined),
            pmcid: item.pmcid,
            doi: item.doi,
            abstract: item.abstractText
              ? xmlToPlainText(item.abstractText)
              : undefined,
            isOpenAccess: item.isOpenAccess === "Y",
            fullTextAvailable:
              item.isOpenAccess === "Y" &&
              item.inEPMC === "Y" &&
              Boolean(item.pmcid),
            fullTextUrls: item.fullTextUrlList?.fullTextUrl
              ?.filter((entry) => entry.availabilityCode === "OA")
              .map((entry) => ({
                style: entry.documentStyle,
                site: entry.site,
                url: entry.url
              })),
            source: item.source,
            id: item.id
          }));

          return {
            query,
            hitCount: payload.hitCount ?? null,
            results
          };
        }
      }),

      /**
       * 对 Europe PMC Open Access subset 读取 JATS/XML 全文。
       * 通过 offsetChars 分页，模型可以真正读完整论文，而不是只看摘要；若文章
       * 不属于可开放全文集合，则明确返回 unavailable，不伪装成“读过全文”。
       */
      read_medical_evidence: tool({
        description:
          "Read open-access full text from Europe PMC by PMCID. Use after search_medical_evidence when fullTextAvailable is true. Supports paging through the entire article.",
        inputSchema: z.object({
          pmcid: z.string().regex(/^PMC\d+$/i),
          offsetChars: z.number().int().min(0).default(0),
          maxChars: z.number().int().min(1000).max(30000).default(12000)
        }),
        execute: async ({ pmcid, offsetChars, maxChars }) => {
          const normalizedPmcid = pmcid.toUpperCase();
          const url = new URL(
            `https://www.ebi.ac.uk/europepmc/webservices/rest/${normalizedPmcid}/fullTextXML`
          );
          const response = await this.fetchEuropePmc(url, "application/xml,text/xml");

          if (response.status === 404) {
            response.body?.cancel();
            return {
              pmcid: normalizedPmcid,
              fullTextAvailable: false,
              message:
                "Europe PMC 没有为该文献提供可通过 fullTextXML 读取的开放全文；请仅依据检索返回的摘要/元数据，并明确说明未读取全文。"
            };
          }
          if (!response.ok) {
            throw new Error(`Europe PMC 全文读取失败：HTTP ${response.status}`);
          }

          const xml = await response.text();
          const fullText = xmlToPlainText(xml);
          const end = Math.min(fullText.length, offsetChars + maxChars);
          return {
            pmcid: normalizedPmcid,
            fullTextAvailable: true,
            offsetChars,
            returnedChars: Math.max(0, end - offsetChars),
            totalChars: fullText.length,
            complete: end >= fullText.length,
            nextOffsetChars: end < fullText.length ? end : null,
            text: fullText.slice(offsetChars, end)
          };
        }
      })
    };
  }

  async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {
    const state = this.getStudyStateInternal();
    const resolved = resolveFamilyModel(this.env, STUDY_MODEL_CONFIG);

    // continuation=true 通常表示同一 turn 在工具结果后继续生成。研究日志只在
    // 真正的新用户 turn 上记录一次 user_message，避免工具循环造成重复计数。
    if (!ctx.continuation) {
      const latestUserText = [...ctx.messages]
        .reverse()
        .map((message) => modelMessageText(message))
        .find(Boolean);
      if (latestUserText) {
        this.appendStudyEvent("user_message", state.stage, {
          text: latestUserText
        });
      }
    }

    console.log(
      `Study turn: case=${state.caseId}, stage=${state.stage}, route=${resolved.route.routeId}, continuation=${ctx.continuation}`
    );

    const isCodex = resolved.route.backendProtocol === "codex-subscription";
    // Codex 的默认缓存域与 session 对齐。把 route 加进去是为了在用户切换
    // 分组/模型时主动开启新的缓存域，避免不同后池复用同一 key；切回来时仍能
    // 回到原来的稳定缓存域。
    const promptCacheKey = `medical-edu:${this.name}:${resolved.route.routeId}`;

    return {
      model: resolved.model,
      // Think 仍然会在底层组装 Workspace 等内置工具。activeTools 是研究边界：
      // 非循证阶段一个工具也不允许调用；循证阶段开放检索 + OA 全文阅读。
      activeTools:
        state.stage === "evidence"
          ? ["search_medical_evidence", "read_medical_evidence"]
          : [],
      // 保留 Session.withCachedPrompt() 冻结的稳定病例/多角色前缀，只在末尾追加
      // 很短的当前阶段角色指令。DeepSeek 的自动上下文缓存按公共前缀命中；这种
      // 结构避免了旧实现每切一次角色就从 system 的第一个 token 开始完全变化。
      instructions: `${ctx.system}\n\n${buildStudyStageDirective(state.stage)}`,
      // 隐藏模型内部 reasoning，避免额外信息影响学生的学习过程。
      sendReasoning: false,
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
    const state = this.getStudyStateInternal();
    this.appendStudyEvent("tool_call", state.stage, {
      toolName: ctx.toolName,
      input: ctx.input
    });
    console.log(`Tool call: ${ctx.toolName}`, JSON.stringify(ctx.input));
  }

  afterToolCall(ctx: ToolCallResultContext): void {
    const state = this.getStudyStateInternal();
    this.appendStudyEvent("tool_result", state.stage, {
      toolName: ctx.toolName,
      success: ctx.success,
      durationMs: ctx.durationMs,
      // 工具返回可能很大，研究日志只保留足够复核的一段快照。
      output: ctx.success
        ? JSON.stringify(ctx.output).slice(0, 6000)
        : String(ctx.error ?? "unknown error").slice(0, 2000)
    });
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

    const route = getModelRoute(STUDY_MODEL_CONFIG.modelRouteId);
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
    const fullText = result.message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    const preview = fullText.slice(0, 120);
    if (fullText) {
      const state = this.getStudyStateInternal();
      this.appendStudyEvent("assistant_message", state.stage, {
        text: fullText,
        status: result.status
      });
    }
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
    // 医学实验版固定模型。保留这个 RPC 只是兼容从 Family AI 派生的旧客户端，
    // 即使有人手工从浏览器调用，也不会改变实际实验模型。
    void config;
    return STUDY_MODEL_CONFIG;
  }

  @callable()
  currentConfig() {
    return STUDY_MODEL_CONFIG;
  }

  @callable()
  getUsageSummary(): UsageSummary {
    const config = STUDY_MODEL_CONFIG;

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
