import { Agent, MemorySession, run, tool } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";

/**
 * OpenAI Agents SDK 对照实验。
 *
 * 目标不是另造一套产品，而是用与 Family AI 当前 Think 路线相同的 DeepSeek V4
 * 和同样的“模型 → Tool → 模型”工作流，量出 OpenAI Agents SDK 的真实行为。
 * 这个脚本只使用内存 Session 和内存文件槽，不会修改线上 Family AI，也不会把
 * API Key 写入日志；通过 Node 的 `--env-file=.env.local` 注入 DEEPSEEK_API_KEY。
 */

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  throw new Error("缺少 DEEPSEEK_API_KEY；请用 --env-file=.env.local 运行实验");
}

// 不向 OpenAI tracing 后端发送实验内容；我们的模型本身也不是 OpenAI 官方 Key。
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

const deepseek = createDeepSeek({ apiKey, baseURL: "https://api.deepseek.com" });
const model = aisdk(deepseek.chat("deepseek-v4-flash"));

const probeFiles = new Map<string, string>();
const toolEvents: Array<{ name: string; input: unknown; output: unknown }> = [];

const writeProbe = tool({
  name: "write_probe",
  description: "Write exact text into the named probe file.",
  parameters: z.object({
    path: z.string(),
    content: z.string()
  }),
  execute: async ({ path, content }) => {
    probeFiles.set(path, content);
    const output = { path, bytesWritten: new TextEncoder().encode(content).length };
    toolEvents.push({ name: "write_probe", input: { path, content }, output });
    return output;
  }
});

const readProbe = tool({
  name: "read_probe",
  description: "Read exact text from the named probe file.",
  parameters: z.object({ path: z.string() }),
  execute: async ({ path }) => {
    const content = probeFiles.get(path) ?? null;
    const output = { path, content, found: content !== null };
    toolEvents.push({ name: "read_probe", input: { path }, output });
    return output;
  }
});

const agent = new Agent({
  name: "Family AI OpenAI Agents SDK PoC",
  instructions:
    "You are a concise test agent. Follow the user's tool instructions exactly. " +
    "When asked to write and read a file, call the tools rather than pretending.",
  model,
  modelSettings: {
    reasoning: { effort: "high" }
  },
  tools: [writeProbe, readProbe]
});

const session = new MemorySession({ sessionId: "family-ai-openai-agents-poc" });

function summarizeUsage(rawResponses: Array<{ usage?: any; rawUsage?: Record<string, unknown> }>) {
  const normalized = rawResponses.map((response, index) => ({
    turn: index + 1,
    requests: response.usage?.requests ?? null,
    inputTokens: response.usage?.inputTokens ?? null,
    outputTokens: response.usage?.outputTokens ?? null,
    totalTokens: response.usage?.totalTokens ?? null,
    rawUsage: response.rawUsage ?? null
  }));
  return normalized;
}

const startedAt = performance.now();
const first = await run(
  agent,
  "Use tools to write exactly OPENAI_AGENTS_TOOL_OK to /poc.txt, then read it back. " +
    "Your final answer must include the exact content you read.",
  {
    session,
    maxTurns: 8
  }
);
const firstElapsedMs = performance.now() - startedAt;

const secondStartedAt = performance.now();
const second = await run(
  agent,
  "Without writing again, tell me the exact value that was stored in /poc.txt. " +
    "If needed, use read_probe.",
  {
    session,
    maxTurns: 6
  }
);
const secondElapsedMs = performance.now() - secondStartedAt;

const history = await session.getItems();
const result = {
  harness: "openai-agents-sdk",
  sdkVersion: "0.17.0",
  model: "deepseek-v4-flash",
  firstRun: {
    elapsedMs: Math.round(firstElapsedMs),
    finalOutput: first.finalOutput,
    modelCalls: first.rawResponses.length,
    usage: summarizeUsage(first.rawResponses)
  },
  secondRun: {
    elapsedMs: Math.round(secondElapsedMs),
    finalOutput: second.finalOutput,
    modelCalls: second.rawResponses.length,
    usage: summarizeUsage(second.rawResponses)
  },
  toolEvents,
  sessionItemCount: history.length,
  storedValue: probeFiles.get("/poc.txt") ?? null
};

console.log(JSON.stringify(result, null, 2));
