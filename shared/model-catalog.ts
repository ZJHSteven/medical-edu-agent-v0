/**
 * Family Agent 的共享模型目录。
 *
 * 这份文件同时被 Worker 端和 React 前端引用，目的有两个：
 * 1. UI 不自己猜“某个分组里有哪些模型/思考档位/上下文窗口”；
 * 2. Worker 端不相信浏览器随便传来的字符串，而是只接受这里列出的 routeId。
 *
 * 注意：API Key 永远不在这里。这里只保存可以公开给浏览器的元数据。
 */

export type ProviderId = "heyiwei" | "haibao" | "deepseek";

export type BackendProtocol = "codex-subscription" | "openai-compatible";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ModelCapabilities = {
  text: boolean;
  vision: boolean;
  nativeWebSearch: boolean;
};

export type TokenPricing = {
  /** 每 100 万输入 token 的美元价格。 */
  inputPerMillionUsd: number;
  /** 每 100 万缓存命中输入 token 的美元价格。 */
  cachedInputPerMillionUsd: number;
  /** 每 100 万输出 token 的美元价格。 */
  outputPerMillionUsd: number;
};

export type ModelRoute = {
  routeId: string;
  providerId: ProviderId;
  providerLabel: string;
  providerShortLabel: string;
  groupId: string;
  groupLabel: string;
  groupShortLabel: string;
  modelId: string;
  modelLabel: string;
  modelShortLabel: string;
  /** 模型/客户端协议公布的原始上下文窗口。 */
  contextWindow: number;
  /**
   * UI 与主动压缩实际采用的安全窗口。
   * Codex 当前按原始窗口的 95% 作为可用上限；普通 API 路由与原始窗口相同。
   */
  effectiveContextWindow: number;
  backendProtocol: BackendProtocol;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  capabilities: ModelCapabilities;
  /**
   * 中转站相对官方 API 标价的计费倍率。
   * 海豹云当前按用户描述视为免费，因此为 0；DeepSeek 官方渠道为 1。
   */
  billingMultiplier: number;
  /** 固定标价；DeepSeek 的峰谷价由 getRoutePricing() 动态计算。 */
  basePricing?: TokenPricing;
};

// GPT-5.6 公共 API 可提供更大的上下文，但何意味/海豹云的 GPT 路由来自
// Codex 订阅后池。当前 Codex 客户端模型目录对 Sol/Terra/Luna 使用 272K，
// 并按 95% 作为实际可用窗口，因此这里不能套公共 API 的 1.05M。
const CODEX_56_CONTEXT = 272_000;
const CODEX_56_EFFECTIVE_CONTEXT = Math.floor(CODEX_56_CONTEXT * 0.95);
const DEEPSEEK_V4_CONTEXT = 1_000_000;

const OPENAI_REASONING: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

const DEEPSEEK_REASONING: ReasoningEffort[] = ["none", "low", "high", "max"];

const OPENAI_56_MODELS = {
  sol: {
    modelId: "gpt-5.6-sol",
    modelLabel: "GPT-5.6 Sol",
    modelShortLabel: "5.6 Sol",
    pricing: {
      inputPerMillionUsd: 4,
      cachedInputPerMillionUsd: 0.4,
      outputPerMillionUsd: 20
    }
  },
  terra: {
    modelId: "gpt-5.6-terra",
    modelLabel: "GPT-5.6 Terra",
    modelShortLabel: "5.6 Terra",
    pricing: {
      inputPerMillionUsd: 2,
      cachedInputPerMillionUsd: 0.2,
      outputPerMillionUsd: 12
    }
  },
  luna: {
    modelId: "gpt-5.6-luna",
    modelLabel: "GPT-5.6 Luna",
    modelShortLabel: "5.6 Luna",
    pricing: {
      inputPerMillionUsd: 0.2,
      cachedInputPerMillionUsd: 0.02,
      outputPerMillionUsd: 1.2
    }
  }
} as const;

type OpenAI56Key = keyof typeof OPENAI_56_MODELS;

function openAIRoute(args: {
  providerId: Extract<ProviderId, "heyiwei" | "haibao">;
  providerLabel: string;
  providerShortLabel: string;
  groupId: string;
  groupLabel: string;
  groupShortLabel: string;
  model: OpenAI56Key;
  billingMultiplier: number;
  nativeWebSearch?: boolean;
}): ModelRoute {
  const model = OPENAI_56_MODELS[args.model];
  return {
    routeId: `${args.providerId}:${args.groupId}:${model.modelId}`,
    providerId: args.providerId,
    providerLabel: args.providerLabel,
    providerShortLabel: args.providerShortLabel,
    groupId: args.groupId,
    groupLabel: args.groupLabel,
    groupShortLabel: args.groupShortLabel,
    modelId: model.modelId,
    modelLabel: model.modelLabel,
    modelShortLabel: model.modelShortLabel,
    contextWindow: CODEX_56_CONTEXT,
    effectiveContextWindow: CODEX_56_EFFECTIVE_CONTEXT,
    backendProtocol: "codex-subscription",
    reasoningEfforts: OPENAI_REASONING,
    defaultReasoningEffort: "medium",
    capabilities: {
      text: true,
      vision: true,
      nativeWebSearch: args.nativeWebSearch ?? false
    },
    billingMultiplier: args.billingMultiplier,
    basePricing: model.pricing
  };
}

const HEYIWEI_GROUPS = [
  { id: "42", label: "炸弹车", short: "炸弹", multiplier: 0.055 },
  { id: "39", label: "企业路线", short: "企业", multiplier: 0.3 },
  { id: "13", label: "Plus 路线", short: "Plus", multiplier: 0.075 },
  { id: "35", label: "白嫖掺水", short: "掺水", multiplier: 0.001 },
  { id: "9", label: "Pro 路线", short: "Pro", multiplier: 0.18 },
  { id: "2", label: "Pro + Plus 混池", short: "混池", multiplier: 0.16 }
] as const;

const heyiweiRoutes: ModelRoute[] = HEYIWEI_GROUPS.flatMap((group) =>
  (["sol", "terra", "luna"] as const).map((model) =>
    openAIRoute({
      providerId: "heyiwei",
      providerLabel: "合一位",
      providerShortLabel: "合一位",
      groupId: group.id,
      groupLabel: group.label,
      groupShortLabel: group.short,
      model,
      billingMultiplier: group.multiplier,
      // 这些 OpenAI 分组都由 Sub2API/Codex 订阅后池调度。Web Search 是
      // Responses 的 hosted tool，应当由当前主模型同一 turn 原生执行。
      nativeWebSearch: true
    })
  )
);

const haibaoRoutes: ModelRoute[] = [
  {
    routeId: "haibao:19:deepseek-v4-flash",
    providerId: "haibao",
    providerLabel: "海豹云",
    providerShortLabel: "海豹云",
    groupId: "19",
    groupLabel: "群友大肥鱼",
    groupShortLabel: "大肥鱼",
    modelId: "deepseek-v4-flash",
    modelLabel: "DeepSeek V4 Flash",
    modelShortLabel: "V4 Flash",
    contextWindow: DEEPSEEK_V4_CONTEXT,
    effectiveContextWindow: DEEPSEEK_V4_CONTEXT,
    backendProtocol: "openai-compatible",
    reasoningEfforts: DEEPSEEK_REASONING,
    defaultReasoningEffort: "high",
    capabilities: { text: true, vision: false, nativeWebSearch: false },
    billingMultiplier: 0
  },
  ...(["sol", "terra", "luna"] as const).map((model) =>
    openAIRoute({
      providerId: "haibao",
      providerLabel: "海豹云",
      providerShortLabel: "海豹云",
      groupId: "2",
      groupLabel: "GPT 分组",
      groupShortLabel: "GPT",
      model,
      billingMultiplier: 0,
      nativeWebSearch: true
    })
  )
];

const deepseekRoutes: ModelRoute[] = [
  {
    routeId: "deepseek:official:deepseek-v4-flash",
    providerId: "deepseek",
    providerLabel: "DeepSeek 官方",
    providerShortLabel: "DeepSeek",
    groupId: "official",
    groupLabel: "官方 API",
    groupShortLabel: "官方",
    modelId: "deepseek-v4-flash",
    modelLabel: "DeepSeek V4 Flash",
    modelShortLabel: "V4 Flash",
    contextWindow: DEEPSEEK_V4_CONTEXT,
    effectiveContextWindow: DEEPSEEK_V4_CONTEXT,
    backendProtocol: "openai-compatible",
    reasoningEfforts: DEEPSEEK_REASONING,
    defaultReasoningEffort: "high",
    capabilities: { text: true, vision: false, nativeWebSearch: false },
    billingMultiplier: 1
  },
  {
    routeId: "deepseek:official:deepseek-v4-pro",
    providerId: "deepseek",
    providerLabel: "DeepSeek 官方",
    providerShortLabel: "DeepSeek",
    groupId: "official",
    groupLabel: "官方 API",
    groupShortLabel: "官方",
    modelId: "deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    modelShortLabel: "V4 Pro",
    contextWindow: DEEPSEEK_V4_CONTEXT,
    effectiveContextWindow: DEEPSEEK_V4_CONTEXT,
    backendProtocol: "openai-compatible",
    reasoningEfforts: DEEPSEEK_REASONING,
    defaultReasoningEffort: "high",
    capabilities: { text: true, vision: false, nativeWebSearch: false },
    billingMultiplier: 1
  },
  {
    routeId: "deepseek:official:deepseek-v4-flash-vision-exp",
    providerId: "deepseek",
    providerLabel: "DeepSeek 官方",
    providerShortLabel: "DeepSeek",
    groupId: "official",
    groupLabel: "官方 API",
    groupShortLabel: "官方",
    modelId: "deepseek-v4-flash-vision-exp",
    modelLabel: "DeepSeek V4 Flash Vision",
    modelShortLabel: "V4 Vision",
    contextWindow: DEEPSEEK_V4_CONTEXT,
    effectiveContextWindow: DEEPSEEK_V4_CONTEXT,
    backendProtocol: "openai-compatible",
    reasoningEfforts: DEEPSEEK_REASONING,
    defaultReasoningEffort: "high",
    capabilities: { text: true, vision: true, nativeWebSearch: false },
    billingMultiplier: 1
  }
];

export const MODEL_ROUTES: ModelRoute[] = [
  ...heyiweiRoutes,
  ...haibaoRoutes,
  ...deepseekRoutes
];

// 首个给家人体验的版本优先选择刚刚实测 200、低延迟且原生支持 V4
// reasoning/cache usage 的官方 DeepSeek 路线。何一位/海豹 GPT 仍保留在选择器中，
// 但不再让一个动态号池故障阻断“打开页面就能聊”的基本体验。
export const DEFAULT_MODEL_ROUTE_ID = "deepseek:official:deepseek-v4-flash";

export function getModelRoute(routeId: string | undefined): ModelRoute {
  return (
    MODEL_ROUTES.find((route) => route.routeId === routeId) ??
    MODEL_ROUTES.find((route) => route.routeId === DEFAULT_MODEL_ROUTE_ID)!
  );
}

/**
 * 返回某一路由此刻应使用的官方 token 标价。
 *
 * DeepSeek 自 2026-08-16 起按 UTC 时段区分峰/谷价格：
 * 01:00–04:00、06:00–10:00 UTC 为峰时，其他时段半价。
 * Vision 实验模型当前没有在公开价目里单列，因此返回 undefined，UI 会显示“待定”。
 */
export function getRoutePricing(
  route: ModelRoute,
  at: Date = new Date(),
  billingMultiplierOverride?: number
): TokenPricing | undefined {
  if (route.basePricing) {
    const multiplier = billingMultiplierOverride ?? route.billingMultiplier;
    return {
      inputPerMillionUsd: route.basePricing.inputPerMillionUsd * multiplier,
      cachedInputPerMillionUsd:
        route.basePricing.cachedInputPerMillionUsd * multiplier,
      outputPerMillionUsd: route.basePricing.outputPerMillionUsd * multiplier
    };
  }

  if (route.providerId !== "deepseek" || route.modelId.includes("vision")) {
    return undefined;
  }

  const hour = at.getUTCHours();
  const peak = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  const half = peak ? 1 : 0.5;

  if (route.modelId === "deepseek-v4-flash") {
    return {
      inputPerMillionUsd: 0.44 * half,
      cachedInputPerMillionUsd: 0.014 * half,
      outputPerMillionUsd: 1.32 * half
    };
  }

  if (route.modelId === "deepseek-v4-pro") {
    return {
      inputPerMillionUsd: 1.32 * half,
      cachedInputPerMillionUsd: 0.044 * half,
      outputPerMillionUsd: 3.96 * half
    };
  }

  return undefined;
}

export function formatReasoningEffort(effort: ReasoningEffort): string {
  const labels: Record<ReasoningEffort, string> = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    max: "Max"
  };
  return labels[effort];
}
