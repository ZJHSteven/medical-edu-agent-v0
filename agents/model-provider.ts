import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import {
  DEFAULT_MODEL_ROUTE_ID,
  getModelRoute,
  type ModelRoute,
  type ReasoningEffort
} from "../shared/model-catalog";
import type { AgentConfig } from "./assistant/types";

/**
 * Family Agent 的多供应商模型适配层。
 *
 * Think 只需要一个 AI SDK LanguageModel；供应商、分组 Key、Base URL、
 * OpenAI Responses 兼容细节全部集中在这里，避免散落到 Agent 主逻辑。
 */

const HEYIWEI_BASE_URL = "https://ai.websee.top/v1";
const HAIBAO_BASE_URL = "http://42.192.94.176:5002/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type ResolvedModel = {
  route: ModelRoute;
  model: LanguageModel;
  /** 只有 Codex/OpenAI Responses 路由才有 hosted web_search provider tools。 */
  openaiProvider?: ReturnType<typeof createOpenAI>;
  reasoningEffort: ReasoningEffort;
};

/**
 * Responses 的最后一道隐私/兼容保险：无论调用方是否显式传入，均保持
 * `store=false`。会话历史仍由 Think/Session 持久化。
 *
 * 注意：这里**不再删除** `previous_response_id`、`prompt_cache_key`、
 * encrypted reasoning 等 Codex 字段。HTTP 何意味当前不会自动产生
 * `previous_response_id`；若以后切到 Responses WebSocket v2，也不能在底层
 * fetch 把 Codex 的续接信息粗暴抹掉。
 */
function createPrivateResponsesFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (
      url.includes("/responses") &&
      init?.method?.toUpperCase() === "POST" &&
      typeof init.body === "string"
    ) {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body.store = false;
        return fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // 如果 SDK 将来改变 body 编码，不猜测新格式，原样转发。
      }
    }

    return fetch(input, init);
  };
}

function required(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`缺少模型路由所需的 Worker Secret：${label}`);
  }
  return value;
}

function getHeyiweiKey(env: Env, groupId: string): string {
  switch (groupId) {
    case "2":
      return required(env.HEYIWEI_G2_KEY, "HEYIWEI_G2_KEY");
    case "9":
      return required(env.HEYIWEI_G9_KEY, "HEYIWEI_G9_KEY");
    case "13":
      return required(env.HEYIWEI_G13_KEY, "HEYIWEI_G13_KEY");
    case "35":
      return required(env.HEYIWEI_G35_KEY, "HEYIWEI_G35_KEY");
    case "39":
      return required(env.HEYIWEI_G39_KEY, "HEYIWEI_G39_KEY");
    case "42":
      return required(env.HEYIWEI_G42_KEY, "HEYIWEI_G42_KEY");
    default:
      throw new Error(`未配置的合一位分组：${groupId}`);
  }
}

function getHaibaoKey(env: Env, groupId: string): string {
  switch (groupId) {
    case "2":
      return required(env.HAIBAO_G2_KEY, "HAIBAO_G2_KEY");
    case "19":
      return required(env.HAIBAO_G19_KEY, "HAIBAO_G19_KEY");
    default:
      throw new Error(`未配置的海豹云分组：${groupId}`);
  }
}

function createOpenAIProviderForRoute(env: Env, route: ModelRoute) {
  if (route.providerId === "heyiwei") {
    return createOpenAI({
      apiKey: getHeyiweiKey(env, route.groupId),
      baseURL: HEYIWEI_BASE_URL,
      // 保持 providerOptions.openai.* 的标准命名空间，方便 Codex reasoning/cache。
      name: "openai",
      fetch: createPrivateResponsesFetch()
    });
  }

  if (route.providerId === "haibao" && route.groupId === "2") {
    return createOpenAI({
      apiKey: getHaibaoKey(env, route.groupId),
      baseURL: HAIBAO_BASE_URL,
      name: "openai",
      fetch: createPrivateResponsesFetch()
    });
  }

  return undefined;
}

/**
 * DeepSeek 路由使用 AI SDK 的专用 provider，而不是把 Chat Completions
 * 强塞给 OpenAI provider。这个 provider 会把 `reasoning_content` 映射为
 * AI SDK reasoning part，并在 DeepSeek V4 的后续 turn/tool continuation 中
 * 按协议重新回传 prior reasoning。
 */
function createDeepSeekProviderForRoute(env: Env, route: ModelRoute) {
  if (route.providerId === "haibao" && route.groupId === "19") {
    return createDeepSeek({
      apiKey: getHaibaoKey(env, route.groupId),
      baseURL: HAIBAO_BASE_URL
    });
  }

  if (route.providerId === "deepseek") {
    return createDeepSeek({
      apiKey: required(env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY"),
      baseURL: DEEPSEEK_BASE_URL
    });
  }

  return undefined;
}

export function normalizeAgentConfig(config?: Partial<AgentConfig> | null): AgentConfig {
  const route = getModelRoute(config?.modelRouteId ?? DEFAULT_MODEL_ROUTE_ID);
  const requested = config?.reasoningEffort;
  const reasoningEffort =
    requested && route.reasoningEfforts.includes(requested)
      ? requested
      : route.defaultReasoningEffort;

  return {
    modelRouteId: route.routeId,
    reasoningEffort,
    persona: config?.persona ?? ""
  };
}

/** 根据当前聊天配置解析真正的模型、分组和思考档位。 */
export function resolveFamilyModel(env: Env, config?: Partial<AgentConfig> | null): ResolvedModel {
  const normalized = normalizeAgentConfig(config);
  const route = getModelRoute(normalized.modelRouteId);
  const openaiProvider = createOpenAIProviderForRoute(env, route);
  if (openaiProvider) {
    return {
      route,
      model: openaiProvider.responses(route.modelId),
      openaiProvider,
      reasoningEffort: normalized.reasoningEffort
    };
  }

  const deepseekProvider = createDeepSeekProviderForRoute(env, route);
  if (!deepseekProvider) {
    throw new Error(`没有可用的模型适配器：${route.routeId}`);
  }

  return {
    route,
    // DeepSeek provider 天然走 Chat Completions，并保留 V4 reasoning_content。
    model: deepseekProvider.chat(route.modelId),
    reasoningEffort: normalized.reasoningEffort
  };
}

/**
 * Web Search 使用的专门搜索路由。
 * api-provider-lab 已经真实验证何意味 g2 的 Responses 会返回 web_search_call。
 * 搜索与主聊天模型解耦，因此用户即使选 DeepSeek/海豹云，仍可调用统一搜索工具。
 */
export function resolveWebSearchModel(env: Env): ResolvedModel {
  return resolveFamilyModel(env, {
    modelRouteId: "heyiwei:2:gpt-5.6-luna",
    reasoningEffort: "low",
    persona: ""
  });
}
