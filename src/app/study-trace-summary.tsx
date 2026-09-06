import { Button } from "@/components/ui/button";
import { ArrowRightIcon, DownloadIcon } from "lucide-react";
import type { StudyState } from "../../shared/study";

type StudyTraceSummaryProps = {
  state: StudyState;
  onExport: () => void | Promise<void>;
  exporting?: boolean;
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
  exporting = false
}: StudyTraceSummaryProps) {
  const initial = state.initialAssessment;
  const final = state.finalReflection;
  if (state.stage !== "completed" || !initial || !final) return null;

  const confidenceDelta = final.confidence - initial.confidence;
  const confidenceDeltaText =
    confidenceDelta === 0
      ? "未变化"
      : `${confidenceDelta > 0 ? "+" : ""}${confidenceDelta} 个百分点`;

  return (
    <div className="border-b border-border/60 bg-background px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-muted/20 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">临床推理轨迹 · 本次训练摘要</div>
            <div className="mt-1 text-xs text-muted-foreground">
              对照学生在 AI 深度反馈前后的显式判断；完整消息、工具调用与阶段事件保存在研究日志中。
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
      </div>
    </div>
  );
}
