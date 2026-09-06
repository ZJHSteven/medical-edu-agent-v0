import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  MODEL_ROUTES,
  formatReasoningEffort,
  getModelRoute,
  type ModelRoute,
  type ProviderId,
  type ReasoningEffort
} from "../../shared/model-catalog";
import type { HeyiweiProviderStatus, ProviderHealth } from "../provider-status";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ModelPickerProps = {
  routeId: string;
  reasoningEffort: ReasoningEffort;
  disabled?: boolean;
  onChange: (value: {
    routeId: string;
    reasoningEffort: ReasoningEffort;
  }) => void | Promise<void>;
};

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "--";
}

function healthDotClass(health: ProviderHealth | undefined): string {
  switch (health) {
    case "healthy":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "critical":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/35";
  }
}

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  logo: string;
}> = [
  { id: "heyiwei", label: "合一位", logo: "openai" },
  { id: "haibao", label: "海豹云", logo: "openai" },
  { id: "deepseek", label: "DeepSeek", logo: "deepseek" }
];

/**
 * 模型按钮只显示“模型短名 + 推理档位”，避免把供应商/分组长名称塞进输入框。
 * 完整的供应商 → 分组 → 模型信息只在弹出的 AI Elements ModelSelector 中出现。
 */
export function ModelPicker({
  routeId,
  reasoningEffort,
  disabled,
  onChange
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [heyiweiStatus, setHeyiweiStatus] = useState<HeyiweiProviderStatus | null>(
    null
  );
  const selected = getModelRoute(routeId);

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/provider-status/heyiwei?range=90m");
        if (!response.ok) return;
        const value = (await response.json()) as HeyiweiProviderStatus;
        if (!disposed) setHeyiweiStatus(value);
      } catch {
        // Provider 状态只是辅助决策；状态接口失败不能阻止用户选择模型。
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const routesByProvider = useMemo(
    () =>
      PROVIDERS.map((provider) => ({
        ...provider,
        routes: MODEL_ROUTES.filter((route) => {
          if (route.providerId !== provider.id) return false;
          if (
            route.providerId !== "heyiwei" ||
            !heyiweiStatus ||
            heyiweiStatus.stale ||
            heyiweiStatus.groups.length === 0
          ) {
            return true;
          }

          // 何一位分组是运行时数据，不把仓库里的候选目录当成实时真相。
          // Console 给出新鲜 active group 列表后，只展示当前真实存在的分组；
          // Console 暂不可用/只有 stale 快照时仍保留静态候选，避免状态服务故障
          // 反过来让用户完全无法手工切路由。
          return heyiweiStatus.groups.some(
            (group) => group.groupId === route.groupId
          );
        })
      })),
    [heyiweiStatus]
  );

  const chooseRoute = async (route: ModelRoute) => {
    const nextEffort = route.reasoningEfforts.includes(reasoningEffort)
      ? reasoningEffort
      : route.defaultReasoningEffort;
    await onChange({ routeId: route.routeId, reasoningEffort: nextEffort });
  };

  const chooseEffort = async (effort: ReasoningEffort) => {
    await onChange({ routeId: selected.routeId, reasoningEffort: effort });
  };

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-8 rounded-full px-2.5 text-xs font-medium"
          />
        }
      >
        <ModelSelectorLogo
          provider={selected.providerId === "deepseek" ? "deepseek" : "openai"}
        />
        <span>{selected.modelShortLabel}</span>
        <span className="text-muted-foreground">
          · {formatReasoningEffort(reasoningEffort)}
        </span>
        <ChevronDownIcon data-icon="inline-end" />
      </ModelSelectorTrigger>

      <ModelSelectorContent
        title="选择模型"
        className="max-h-[78dvh] w-[min(94vw,620px)] max-w-none overflow-hidden"
      >
        <ModelSelectorInput placeholder="搜索供应商、分组或模型…" />
        {heyiweiStatus ? (
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              何一位 · {heyiweiStatus.range}
              {heyiweiStatus.stale ? " · 缓存快照" : " · 实时"}
            </span>
            <span className="font-mono">
              余额 ${heyiweiStatus.account.balance?.toFixed(2) ?? "--"}
            </span>
          </div>
        ) : null}
        <ModelSelectorList className="max-h-[52dvh]">
          <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
          {routesByProvider.map((provider) => (
            <ModelSelectorGroup key={provider.id} heading={provider.label}>
              {provider.routes.map((route) => {
                const groupStatus =
                  route.providerId === "heyiwei"
                    ? heyiweiStatus?.groups.find(
                        (group) => group.groupId === route.groupId
                      )
                    : undefined;
                const modelStatus =
                  route.providerId === "heyiwei"
                    ? heyiweiStatus?.models.find(
                        (model) => model.model === route.modelId
                      )
                    : undefined;

                return (
                  <ModelSelectorItem
                    key={route.routeId}
                    value={`${route.providerLabel} ${route.groupLabel} ${route.modelLabel}`}
                    onSelect={() => void chooseRoute(route)}
                    className="gap-3 py-2.5"
                  >
                    <ModelSelectorLogo provider={provider.logo} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {route.providerId === "heyiwei" ? (
                          <span
                            className={`size-2 shrink-0 rounded-full ${healthDotClass(groupStatus?.health)}`}
                            title={groupStatus?.health ?? "unknown"}
                          />
                        ) : null}
                        <ModelSelectorName className="font-medium">
                          {route.modelShortLabel}
                        </ModelSelectorName>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {route.providerShortLabel} · {route.groupShortLabel}
                        {groupStatus
                          ? ` · ${groupStatus.multiplier?.toFixed(3) ?? "--"}x · 组成功 ${formatPercent(groupStatus.successRate)} · Cache ${formatPercent(groupStatus.cacheRate)}`
                          : ""}
                      </div>
                      {modelStatus ? (
                        <div className="truncate text-[11px] text-muted-foreground/80">
                          模型总体成功 {formatPercent(modelStatus.successRate)} · Cache {formatPercent(modelStatus.cacheRate)}
                        </div>
                      ) : null}
                    </div>
                    {selected.routeId === route.routeId ? (
                      <CheckIcon className="text-foreground" />
                    ) : null}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>

        <Separator />
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">思考强度</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {selected.providerShortLabel} · {selected.groupShortLabel} · {selected.modelShortLabel}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {selected.backendProtocol === "codex-subscription"
                ? `${Math.round(selected.contextWindow / 1000)}K · 可用 ${Math.round(selected.effectiveContextWindow / 1000)}K`
                : `${(selected.contextWindow / 1_000_000).toFixed(2)}M context`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected.reasoningEfforts.map((effort) => (
              <Button
                key={effort}
                type="button"
                size="sm"
                variant={reasoningEffort === effort ? "default" : "outline"}
                className="h-7 rounded-full px-2.5 text-[11px]"
                onClick={() => void chooseEffort(effort)}
              >
                {formatReasoningEffort(effort)}
              </Button>
            ))}
          </div>
        </div>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
