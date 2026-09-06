import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger
} from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { getModelRoute } from "../../shared/model-catalog";
import type { UsageSummary } from "../../agents/assistant/types";

type UsageIndicatorProps = {
  usage: UsageSummary | null;
};

function formatTokens(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function formatUsd(value: number | null) {
  if (value === null) return "费用待定";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

/** 手机端复用的上下文圆环视觉；真正的点击语义由 PopoverTrigger 直接接管。 */
function UsageRingGraphic({ usage }: { usage: UsageSummary }) {
  const percent = Math.min(100, Math.max(0, usage.contextPercent));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);

  return (
    <>
      <span className="font-medium text-muted-foreground">
        {percent.toFixed(percent < 10 ? 1 : 0)}%
      </span>
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        className="text-muted-foreground"
      >
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.25"
        />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </svg>
    </>
  );
}

/** 手机 tap 弹层使用的详情正文；只展示 Worker 已计算好的真实 usage。 */
function MobileUsageDetails({ usage }: { usage: UsageSummary }) {
  const route = getModelRoute(usage.modelRouteId);

  return (
    <PopoverContent
      align="end"
      side="top"
      className="w-72 gap-0 overflow-hidden p-0"
    >
      <div className="border-b p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">上下文使用</span>
          <span className="font-mono text-muted-foreground">
            {usage.contextPercent.toFixed(1)}%
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextWindow)}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">累计输入</span>
          <span className="font-mono">{formatTokens(usage.inputTokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">缓存输入</span>
          <span className="font-mono">{formatTokens(usage.cachedInputTokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">累计输出</span>
          <span className="font-mono">{formatTokens(usage.outputTokens)}</span>
        </div>
        {usage.reasoningTokens > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Reasoning</span>
            <span className="font-mono">{formatTokens(usage.reasoningTokens)}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t bg-secondary p-3 text-xs">
        <span>
          {route.providerShortLabel} · {route.groupShortLabel}
        </span>
        <span className="font-mono font-medium">
          {formatUsd(usage.estimatedCostUsd)}
        </span>
      </div>
    </PopoverContent>
  );
}

/**
 * Codex 风格上下文圆环。
 *
 * 注意：这里完全不在浏览器重新 tokenize。`usage.contextTokens` 来自 Think
 * onStepFinish 收到的供应商真实 inputTokens，费用也是 Worker 根据同一份真实 usage
 * 与 route 的计费倍率算好后返回。前端只负责展示。
 */
export function UsageIndicator({ usage }: UsageIndicatorProps) {
  if (!usage) {
    return (
      <div className="flex h-8 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground">
        <span className="size-3 rounded-full border-2 border-muted-foreground/30" />
        <span>--</span>
      </div>
    );
  }

  const route = getModelRoute(usage.modelRouteId);

  return (
    <>
      {/* 手机：PreviewCard 没有可靠 hover，因此用真正由 tap 驱动的 Popover。 */}
      <div className="md:hidden">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-2 text-[11px]"
                aria-label="查看上下文与费用详情"
              />
            }
          >
            <UsageRingGraphic usage={usage} />
          </PopoverTrigger>
          <MobileUsageDetails usage={usage} />
        </Popover>
      </div>

      {/* 桌面：继续保留 AI Elements 原生 Context/HoverCard 的即时悬浮体验。 */}
      <div className="hidden md:block">
        <Context
          usedTokens={usage.contextTokens}
          maxTokens={usage.contextWindow}
          modelId={route.modelId}
        >
          <ContextTrigger
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2 text-[11px]"
          />
          <ContextContent align="end" side="top" className="w-72">
            <ContextContentHeader />
            <ContextContentBody className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">当前上下文</span>
                <span className="font-mono">
                  {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextWindow)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">累计输入</span>
                <span className="font-mono">{formatTokens(usage.inputTokens)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">缓存输入</span>
                <span className="font-mono">{formatTokens(usage.cachedInputTokens)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">累计输出</span>
                <span className="font-mono">{formatTokens(usage.outputTokens)}</span>
              </div>
              {usage.reasoningTokens > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Reasoning</span>
                  <span className="font-mono">{formatTokens(usage.reasoningTokens)}</span>
                </div>
              ) : null}
            </ContextContentBody>
            <ContextContentFooter className="flex items-center justify-between">
              <span>
                {route.providerShortLabel} · {route.groupShortLabel}
              </span>
              <span className="font-mono font-medium">
                {formatUsd(usage.estimatedCostUsd)}
              </span>
            </ContextContentFooter>
          </ContextContent>
        </Context>
      </div>
    </>
  );
}

export function UsageCaption({ usage }: UsageIndicatorProps) {
  if (!usage) return <span>上下文与费用将在首轮响应后显示</span>;
  const route = getModelRoute(usage.modelRouteId);
  return (
    <span>
      上下文 {usage.contextPercent.toFixed(1)}% · 累计 {formatTokens(usage.totalTokens)} tokens · {formatUsd(usage.estimatedCostUsd)} · {route.providerShortLabel}/{route.groupShortLabel}
    </span>
  );
}
