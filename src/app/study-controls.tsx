import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRightIcon, CheckCircle2Icon, ClipboardCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  STUDY_STAGE_LABELS,
  STUDY_STAGES,
  type FinalReflection,
  type InitialAssessment,
  type StudyState
} from "../../shared/study";

type StudyControlsProps = {
  state: StudyState;
  disabled?: boolean;
  onSubmitInitial: (assessment: InitialAssessment) => Promise<void>;
  onAdvanceEvidence: () => Promise<void>;
  onAdvanceReflection: () => Promise<void>;
  onSubmitFinal: (reflection: FinalReflection) => Promise<void>;
};

function StageProgress({ state }: { state: StudyState }) {
  const currentIndex = STUDY_STAGES.indexOf(state.stage);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {STUDY_STAGES.map((stage, index) => {
        const reached = index <= currentIndex;
        const current = stage === state.stage;
        return (
          <div key={stage} className="flex shrink-0 items-center gap-1">
            {index > 0 ? (
              <div className={`h-px w-3 ${reached ? "bg-foreground/40" : "bg-border"}`} />
            ) : null}
            <span
              className={`rounded-full px-2 py-1 text-[11px] ${
                current
                  ? "bg-foreground font-medium text-background"
                  : reached
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {STUDY_STAGE_LABELS[stage]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 训练阶段条 + 结构化研究提交入口。
 *
 * 普通对话仍走 Think/AI Elements；只有论文真正需要稳定字段的节点（初判和
 * 最终反思）才使用表单提交，这样既保留自然交互，又能得到可直接统计的数据。
 */
export function StudyControls({
  state,
  disabled,
  onSubmitInitial,
  onAdvanceEvidence,
  onAdvanceReflection,
  onSubmitFinal
}: StudyControlsProps) {
  const [initialOpen, setInitialOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [primaryDiagnosis, setPrimaryDiagnosis] = useState("");
  const [differentials, setDifferentials] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [initialConfidence, setInitialConfidence] = useState(50);

  const [finalDiagnosis, setFinalDiagnosis] = useState("");
  const [revisedReasoning, setRevisedReasoning] = useState("");
  const [evidenceImpact, setEvidenceImpact] = useState("");
  const [reflection, setReflection] = useState("");
  const [finalConfidence, setFinalConfidence] = useState(
    state.initialAssessment?.confidence ?? 50
  );

  const action = useMemo(() => {
    if (state.stage === "history") {
      return { label: "提交初步判断", run: () => setInitialOpen(true) };
    }
    if (state.stage === "clinical_feedback") {
      return { label: "进入循证拓展", run: onAdvanceEvidence };
    }
    if (state.stage === "evidence") {
      return { label: "进入反思修订", run: onAdvanceReflection };
    }
    if (state.stage === "reflection") {
      return { label: "提交最终判断与反思", run: () => setFinalOpen(true) };
    }
    return null;
  }, [onAdvanceEvidence, onAdvanceReflection, state.stage]);

  const runAction = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="border-b border-border/60 bg-background/95 px-3 py-2 sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <StageProgress state={state} />
          {state.stage === "completed" ? (
            <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-4" />
              训练完成
            </div>
          ) : action ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 rounded-full"
              disabled={disabled || busy}
              onClick={() => void runAction(action.run)}
            >
              {action.label}
              <ArrowRightIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {error ? (
          <div className="mx-auto mt-1 w-full max-w-4xl text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <Dialog
        // 阶段已经由服务端推进后，无论本地 Dialog state 是否因为异步 RPC/热更新
        // 晚一拍，都不允许继续把“第一次判断”表单留在屏幕上。服务端本身也会
        // 拒绝第二次提交，这里再把 UI 可见性与权威阶段绑定，避免学生误以为可改。
        open={initialOpen && state.stage === "history"}
        onOpenChange={setInitialOpen}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>提交第一次临床判断</DialogTitle>
            <DialogDescription>
              提交后进入临床导师反馈阶段。第一次判断会作为研究数据保留，之后不能覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">最可能诊断</span>
              <Input
                value={primaryDiagnosis}
                onChange={(event) => setPrimaryDiagnosis(event.target.value)}
                placeholder="写下你当前认为最可能的诊断"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">鉴别诊断</span>
              <Textarea
                value={differentials}
                onChange={(event) => setDifferentials(event.target.value)}
                placeholder="列出需要鉴别的疾病及理由"
                className="min-h-24"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">推理依据</span>
              <Textarea
                value={reasoning}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder="哪些病史、体征或检查支持你的判断？"
                className="min-h-28"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="flex items-center justify-between font-medium">
                当前把握度
                <span className="text-muted-foreground">{initialConfidence}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={initialConfidence}
                onChange={(event) => setInitialConfidence(Number(event.target.value))}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setInitialOpen(false)}>
              继续问诊
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                !primaryDiagnosis.trim() ||
                !differentials.trim() ||
                !reasoning.trim()
              }
              onClick={() =>
                void runAction(async () => {
                  await onSubmitInitial({
                    primaryDiagnosis,
                    differentials,
                    reasoning,
                    confidence: initialConfidence
                  });
                  setInitialOpen(false);
                })
              }
            >
              <ClipboardCheckIcon />
              确认提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        // 最终提交同理：一旦状态变成 completed，立即从 UI 上收起表单。
        open={finalOpen && state.stage === "reflection"}
        onOpenChange={setFinalOpen}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>最终判断与学习反思</DialogTitle>
            <DialogDescription>
              请比较你最初的思路与经过导师反馈、循证检索后的最终判断。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">最终诊断</span>
              <Input
                value={finalDiagnosis}
                onChange={(event) => setFinalDiagnosis(event.target.value)}
                placeholder="你的最终诊断"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">修订后的推理链</span>
              <Textarea
                value={revisedReasoning}
                onChange={(event) => setRevisedReasoning(event.target.value)}
                placeholder="现在你怎样组织诊断依据和鉴别诊断？"
                className="min-h-24"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">循证信息怎样影响了你的判断？</span>
              <Textarea
                value={evidenceImpact}
                onChange={(event) => setEvidenceImpact(event.target.value)}
                placeholder="哪些证据改变、加强或没有改变你的观点？"
                className="min-h-24"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">反思</span>
              <Textarea
                value={reflection}
                onChange={(event) => setReflection(event.target.value)}
                placeholder="这次推理中你最大的遗漏、修正或不确定性是什么？"
                className="min-h-24"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="flex items-center justify-between font-medium">
                最终把握度
                <span className="text-muted-foreground">{finalConfidence}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={finalConfidence}
                onChange={(event) => setFinalConfidence(Number(event.target.value))}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFinalOpen(false)}>
              返回继续思考
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                !finalDiagnosis.trim() ||
                !revisedReasoning.trim() ||
                !evidenceImpact.trim() ||
                !reflection.trim()
              }
              onClick={() =>
                void runAction(async () => {
                  await onSubmitFinal({
                    finalDiagnosis,
                    revisedReasoning,
                    evidenceImpact,
                    reflection,
                    confidence: finalConfidence
                  });
                  setFinalOpen(false);
                })
              }
            >
              <CheckCircle2Icon />
              完成训练
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

