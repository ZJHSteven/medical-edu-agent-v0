import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { StudyStage } from "../../shared/study";

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  /** 医学版中每个聊天就是一次病例训练。 */
  caseId?: string;
  /** 侧栏直接展示训练进度，无需逐个唤醒子 Agent。 */
  stage?: StudyStage;
}

export interface DirectoryState {
  chats: ChatSummary[];
}

/**
 * Tool descriptor the directory returns to children over RPC. Mirrors
 * what `MCPClientManager.listTools()` returns: an MCP SDK `Tool` plus
 * the `serverId` annotation so the child can build a `callMcpTool`
 * closure, while staying structured-cloneable for the DO RPC boundary.
 */
export type McpToolDescriptor = Tool & { serverId: string };

import type { ReasoningEffort } from "../../shared/model-catalog";

export type AgentConfig = {
  /** 共享模型目录中的唯一 routeId，例如 heyiwei:2:gpt-5.6-luna。 */
  modelRouteId: string;
  /** 模型推理强度；Worker 会再次按该模型允许值校验。 */
  reasoningEffort: ReasoningEffort;
  /** 用户可选的长期 persona；留空时使用 Family AI 默认系统提示。 */
  persona: string;
};

/**
 * 前端上下文圆环和费用明细所需的真实 usage 汇总。
 * `contextTokens` 取最后一个模型 step 的 inputTokens，因此比浏览器 tokenizer
 * 估算更接近供应商实际计费/上下文长度。
 */
export type UsageSummary = {
  modelRouteId: string;
  contextTokens: number;
  contextWindow: number;
  contextPercent: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  updatedAt: number | null;
};
