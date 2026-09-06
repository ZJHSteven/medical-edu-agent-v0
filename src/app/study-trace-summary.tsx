import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  ArrowRightIcon,
  BrainCircuitIcon,
  DownloadIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon
} from "lucide-react";
import type { StudyState } from "../../shared/study";

export type EvidenceLedgerEntry = {
  kind: "search" | "fulltext";
  title: string;
  detail?: string;
  references?: Array<{
    title: string;
    year?: string;
    pmid?: string;
    pmcid?: string;
    doi?: string;
  }>;
};

type StudyTraceSummaryProps = {
  state: StudyState;
  onExport: () => void | Promise<void>;
  exporting?: boolean;
  aiSummary?: string;
  summarizing?: boolean;
  evidenceLedger?: EvidenceLedgerEntry[];
  onRegenerateSummary?: () => void | Promise<void>;
};

/**
 * 完成病例后的最小“推理轨迹”可视化。
 *
 * 这里展示的全部是学生显式提交的数据，不读取、推断或展示模型内部思维链。
 * 第一版故意只做初判/终判对照；完整教师端后续再叠加事件时间线、病例 rubric
 * 和跨学生汇总，避免为了演示破坏当前已经稳定的训练主流程。
 */
export function StudyTraceSummary({
  state,
  onExport,
  exporting = false,
  aiSummary,
  summarizing = false,
  evidenceLedger = [],
  onRegenerateSummary
}: StudyTraceSummaryProps) {
  const initial = state.initialAssessment;
  const final = state.finalReflection;
  if (state.stage !== "completed" || !initial || !final) return null;

  const confidenceDelta = final.confidence - initial.confidence;
  const confidenceDeltaText =
    confidenceDelta === 0
      ? "未变化"
      : `${confidenceDelta > 0 ? "+" : ""}${confidenceDelta} 个百分点`;
  const durationMinutes = Math.max(
    0,
    Math.round((state.updatedAt - state.startedAt) / 60_000)
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5 sm:px-6">
      <div className="mx-auto grid w-full max-w-4xl gap-4 pb-8">
        <div className="rounded-2xl border bg-muted/20 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">临床推理轨迹 · 本次训练总结</div>
            <div className="mt-1 text-xs text-muted-foreground">
              结构化数据来自学生显式提交和系统事件；AI 总结负责解释这些变化，不替代后续教师正式评分。
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void onExport()}
          >
            <DownloadIcon />
            {exporting ? "正在导出" : "导出研究 JSON"}
          </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border bg-background px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">训练用时</div>
            <div className="mt-1 text-lg font-semibold">{durationMinutes} min</div>
          </div>
          <div className="rounded-xl border bg-background px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">初始把握度</div>
            <div className="mt-1 text-lg font-semibold">{initial.confidence}%</div>
          </div>
          <div className="rounded-xl border bg-background px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">最终把握度变化</div>
            <div className="mt-1 text-lg font-semibold">{confidenceDeltaText}</div>
          </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          <div className="rounded-xl border bg-background p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              初始判断
            </div>
            <div className="mt-2 text-sm font-semibold">{initial.primaryDiagnosis}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              把握度 {initial.confidence}%
            </div>
            <div className="mt-3 text-xs leading-5">
              <span className="font-medium">鉴别：</span>
              {initial.differentials}
            </div>
            <div className="mt-2 text-xs leading-5">
              <span className="font-medium">依据：</span>
              {initial.reasoning}
            </div>
          </div>

          <div className="hidden items-center justify-center sm:flex">
            <ArrowRightIcon className="size-5 text-muted-foreground" />
          </div>

          <div className="rounded-xl border bg-background p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              最终判断
            </div>
            <div className="mt-2 text-sm font-semibold">{final.finalDiagnosis}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              把握度 {final.confidence}% · 较初判 {confidenceDeltaText}
            </div>
            <div className="mt-3 text-xs leading-5">
              <span className="font-medium">修订：</span>
              {final.revisedReasoning}
            </div>
            <div className="mt-2 text-xs leading-5">
              <span className="font-medium">证据影响：</span>
              {final.evidenceImpact}
            </div>
          </div>
          </div>

          <div className="mt-3 rounded-xl border border-dashed bg-background/70 px-3 py-2.5 text-xs leading-5">
          <span className="font-medium">学生反思：</span>
          {final.reflection}
          </div>
          <div className="mt-2 rounded-xl border border-dashed bg-background/70 px-3 py-2.5 text-xs leading-5">
          <span className="font-medium">认知偏差复盘：</span>
          {final.cognitiveBiasReflection || "本次旧记录未单独采集认知偏差复盘。"}
          </div>
        </div>

        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
              <SearchIcon className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Evidence Ledger · 系统记录</div>
              <div className="mt-1 text-xs text-muted-foreground">
                直接来自本轮真实工具调用，不依赖 AI 在总结里回忆或重写；因此即使总结格式漂移，检索与全文阅读轨迹仍然可复核。
              </div>
            </div>
          </div>

          {evidenceLedger.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {evidenceLedger.map((entry, index) => (
                <div
                  key={`${entry.kind}-${index}-${entry.title}`}
                  className="rounded-xl border bg-muted/15 p-3"
                >
                  <div className="text-xs font-semibold">{entry.title}</div>
                  {entry.detail ? (
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {entry.detail}
                    </div>
                  ) : null}
                  {entry.references && entry.references.length > 0 ? (
                    <div className="mt-2 grid gap-2">
                      {entry.references.map((reference, refIndex) => (
                        <div
                          key={`${reference.pmid ?? reference.pmcid ?? reference.doi ?? refIndex}`}
                          className="rounded-lg border bg-background px-3 py-2 text-xs"
                        >
                          <div className="font-medium leading-5">{reference.title}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {[
                              reference.year,
                              reference.pmid ? `PMID ${reference.pmid}` : undefined,
                              reference.pmcid ? `PMCID ${reference.pmcid}` : undefined,
                              reference.doi ? `DOI ${reference.doi}` : undefined
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed px-3 py-3 text-xs text-muted-foreground">
              本轮没有持久化到可展示的 Europe PMC 工具结果；旧记录可能产生于 Evidence Ledger 功能上线之前。
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
              <BrainCircuitIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold">AI 总结与形成性评价</div>
                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                  同一会话 · 第五阶段
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                包含推理轨迹解释、Evidence Ledger、认知偏差复盘和 4 维形成性评分；评分仅用于学习反馈与演示。
              </div>
            </div>
            {onRegenerateSummary ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={summarizing}
                onClick={() => void onRegenerateSummary()}
              >
                <RefreshCwIcon className={summarizing ? "animate-spin" : undefined} />
                {summarizing ? "重新生成中" : "重新生成总结"}
              </Button>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border bg-muted/15 p-4">
            {aiSummary ? (
              <MessageResponse>{aiSummary}</MessageResponse>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SparklesIcon className="size-4" />
                {summarizing ? (
                  <Shimmer duration={1.2}>正在基于本轮完整会话生成结构化学习总结…</Shimmer>
                ) : (
                  "尚未生成学习总结，可重新进入本病例完成阶段后重试。"
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
