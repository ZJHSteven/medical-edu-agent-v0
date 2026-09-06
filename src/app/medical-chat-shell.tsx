import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import {
  BookOpenCheckIcon,
  DownloadIcon,
  GraduationCapIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Share2Icon,
  StethoscopeIcon,
  Trash2Icon,
  UserRoundIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatSummary } from "../../agents/assistant/types";
import { getPublicMedicalCase } from "../../shared/medical-cases";
import type {
  FinalReflection,
  InitialAssessment,
  StudyStage,
  StudyState
} from "../../shared/study";
import { ChatMessageView } from "./message-view";
import { StudyComposer } from "./study-composer";
import { StudyControls } from "./study-controls";
import { StudyTraceSummary } from "./study-trace-summary";

type MedicalChatShellProps = {
  chat: ChatSummary;
  onOpenSidebar: () => void;
  onNewChat: () => void | Promise<void>;
  onDeleteChat: (chatId: string) => void | Promise<void>;
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function stageRoleLabel(stage: StudyStage) {
  switch (stage) {
    case "history":
      return "虚拟患者";
    case "clinical_feedback":
      return "临床导师";
    case "evidence":
      return "科研导师";
    case "reflection":
      return "临床导师 · 反思";
    case "completed":
      return "学习总结";
  }
}

function stagePlaceholder(stage: StudyStage) {
  switch (stage) {
    case "history":
      return "向虚拟患者提问，例如：这次最主要哪里不舒服？";
    case "clinical_feedback":
      return "回答临床导师的追问，或询问自己推理中的薄弱环节";
    case "evidence":
      return "向科研导师提出需要证据支持的临床问题";
    case "reflection":
      return "梳理你准备怎样修改最初的判断";
    case "completed":
      return "本次训练已完成";
  }
}

const INTERNAL_HANDOFF_PREFIX = "[[MEDICAL_EDU_HANDOFF:";

type MedicalMessageMetadata = {
  medicalEdu?: {
    kind?: "handoff";
    targetStage?: StudyStage;
  };
};

function messageMetadata(message: UIMessage) {
  return (message.metadata ?? {}) as MedicalMessageMetadata;
}

function isInternalHandoffMessage(message: UIMessage) {
  if (message.role !== "user") return false;
  if (messageMetadata(message).medicalEdu?.kind === "handoff") return true;
  const text = messageText(message).trim();
  return (
    text.startsWith(INTERNAL_HANDOFF_PREFIX) ||
    text.startsWith("【第一次临床判断】") ||
    text.startsWith("我准备进入循证拓展阶段。请作为科研导师") ||
    text.startsWith("我已经完成本轮循证拓展。请帮助我比较") ||
    text.startsWith("【最终判断与反思】")
  );
}

function handoffTarget(message: UIMessage): StudyStage | null {
  if (message.role !== "user") return null;
  const metadataTarget = messageMetadata(message).medicalEdu?.targetStage;
  if (metadataTarget) return metadataTarget;
  const text = messageText(message).trim();

  if (
    text.startsWith("[[MEDICAL_EDU_HANDOFF:clinical_feedback]]") ||
    text.startsWith("【第一次临床判断】")
  ) {
    return "clinical_feedback";
  }
  if (
    text.startsWith("[[MEDICAL_EDU_HANDOFF:evidence]]") ||
    text.startsWith("我准备进入循证拓展阶段。请作为科研导师")
  ) {
    return "evidence";
  }
  if (
    text.startsWith("[[MEDICAL_EDU_HANDOFF:reflection]]") ||
    text.startsWith("我已经完成本轮循证拓展。请帮助我比较")
  ) {
    return "reflection";
  }
  if (
    text.startsWith("[[MEDICAL_EDU_HANDOFF:completed]]") ||
    text.startsWith("【最终判断与反思】")
  ) {
    return "completed";
  }
  return null;
}

function stageAgentDescription(stage: StudyStage) {
  switch (stage) {
    case "history":
      return "独立患者角色 · 仅按问诊披露病例信息";
    case "clinical_feedback":
      return "临床教学角色 · 聚焦诊断推理、鉴别诊断与下一步验证";
    case "evidence":
      return "科研教学角色 · 可自主检索并阅读 Europe PMC 医学证据";
    case "reflection":
      return "临床教学角色 · 对照初判、反馈与证据完成反思修订";
    case "completed":
      return "本次训练已完成 · 当前仅显示学习总结";
  }
}

function StageAgentIcon({ stage }: { stage: StudyStage }) {
  if (stage === "history") return <UserRoundIcon className="size-4" />;
  if (stage === "evidence") return <BookOpenCheckIcon className="size-4" />;
  return <GraduationCapIcon className="size-4" />;
}

/**
 * 医学病例训练的主聊天页。
 *
 * 连接方式仍然与原 Family AI 一样：浏览器连接用户自己的 Directory，再进入
 * 当前病例训练对应的 MyAssistant facet。差别在于本页只消费研究所需 RPC，
 * 不暴露模型选择、通用工具、消息编辑/重生成等可能改变实验条件的功能。
 */
export function MedicalChatShell({
  chat,
  onOpenSidebar,
  onNewChat,
  onDeleteChat
}: MedicalChatShellProps) {
  const [draft, setDraft] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [studyState, setStudyState] = useState<StudyState | null>(null);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [exportingStudyData, setExportingStudyData] = useState(false);
  const [localStageBoundary, setLocalStageBoundary] = useState<{
    stage: StudyStage;
    startIndex: number;
  } | null>(null);

  const agent = useAgent({
    agent: "AssistantDirectory",
    basePath: "chat",
    sub: [{ agent: "MyAssistant", name: chat.id }],
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
    onClose: useCallback(() => setConnectionStatus("disconnected"), []),
    onError: useCallback((event: Event) => {
      console.error("Medical study WebSocket error", event);
      setConnectionStatus("disconnected");
    }, [])
  });

  const { messages, sendMessage, stop, isStreaming, error, clearError } =
    useAgentChat({
      agent,
      // Family AI 已定位到上游 resumable replay framing 边界问题；医学 Demo
      // 先继承稳定设置，普通实时流与消息持久化不受影响。
      resume: false,
      experimental_throttle: 80,
      getInitialMessages: null
    });

  const refreshStudyState = useCallback(async () => {
    try {
      const value = (await agent.call("getStudyState", [])) as StudyState;
      setStudyState(value);
      setStudyError(null);
      return value;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "无法读取训练状态";
      setStudyError(message);
      throw reason;
    }
  }, [agent]);

  const exportStudyData = useCallback(async () => {
    setExportingStudyData(true);
    setStudyError(null);
    try {
      const exported = await agent.call("exportStudyData", []);
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medical-study-${chat.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setStudyError(reason instanceof Error ? reason.message : "研究数据导出失败");
    } finally {
      setExportingStudyData(false);
    }
  }, [agent, chat.id]);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    void refreshStudyState();
  }, [connectionStatus, chat.id, refreshStudyState]);

  useEffect(() => {
    setLocalStageBoundary(null);
  }, [chat.id]);

  const sendText = useCallback(
    (text: string, handoffTargetStage?: StudyStage) => {
      if (isStreaming || !text.trim()) return;
      clearError();
      setDraft("");
      sendMessage({
        role: "user",
        ...(handoffTargetStage
          ? {
              metadata: {
                medicalEdu: {
                  kind: "handoff" as const,
                  targetStage: handoffTargetStage
                }
              }
            }
          : {}),
        parts: [{ type: "text", text: text.trim() }]
      });
    },
    [clearError, isStreaming, sendMessage]
  );

  const submitInitial = useCallback(
    async (assessment: InitialAssessment) => {
      if (isStreaming) return;
      const state = (await agent.call("submitInitialAssessment", [
        assessment
      ])) as StudyState;
      setLocalStageBoundary({ stage: state.stage, startIndex: messages.length });
      setStudyState(state);
      sendText(
        `[[MEDICAL_EDU_HANDOFF:clinical_feedback]]\n` +
          `【第一次临床判断】\n最可能诊断：${assessment.primaryDiagnosis}\n` +
          `鉴别诊断：${assessment.differentials}\n` +
          `推理依据：${assessment.reasoning}\n` +
          `当前把握度：${assessment.confidence}%\n\n` +
          "请作为临床导师针对我的推理过程给予反馈，不要直接替我完成最终答案。",
        state.stage
      );
    },
    [agent, isStreaming, messages.length, sendText]
  );

  const advanceEvidence = useCallback(async () => {
    if (isStreaming) return;
    const state = (await agent.call("advanceToEvidence", [])) as StudyState;
    setLocalStageBoundary({ stage: state.stage, startIndex: messages.length });
    setStudyState(state);
    sendText(
      "[[MEDICAL_EDU_HANDOFF:evidence]]\n我准备进入循证拓展阶段。请作为科研导师，根据当前病例和前面的推理，帮助我把关键不确定性转化成可检索的循证问题，并检索真实文献证据。",
      state.stage
    );
  }, [agent, isStreaming, messages.length, sendText]);

  const advanceReflection = useCallback(async () => {
    if (isStreaming) return;
    const state = (await agent.call("advanceToReflection", [])) as StudyState;
    setLocalStageBoundary({ stage: state.stage, startIndex: messages.length });
    setStudyState(state);
    sendText(
      "[[MEDICAL_EDU_HANDOFF:reflection]]\n我已经完成本轮循证拓展。请帮助我比较最初判断、临床反馈和检索到的证据，提示我应该重点反思哪些变化，但不要替我写最终反思。",
      state.stage
    );
  }, [agent, isStreaming, messages.length, sendText]);

  const submitFinal = useCallback(
    async (reflection: FinalReflection) => {
      if (isStreaming) return;
      const state = (await agent.call("submitFinalReflection", [
        reflection
      ])) as StudyState;
      setLocalStageBoundary({ stage: state.stage, startIndex: messages.length });
      setStudyState(state);
      // 与前面三个阶段完全使用同一条 handoff 路径：状态推进后，在同一个
      // Think session 中追加隐藏控制消息，让 completed 阶段继续复用已有上下文
      // 与 provider prompt cache。不要为总结再创建第二套 RPC/Agent 交互机制。
      sendText(
        `[[MEDICAL_EDU_HANDOFF:completed]]\n` +
          `【最终判断与反思】\n最终诊断：${reflection.finalDiagnosis}\n` +
          `修订后的推理：${reflection.revisedReasoning}\n` +
          `循证信息的影响：${reflection.evidenceImpact}\n` +
          `认知偏差复盘：${reflection.cognitiveBiasReflection}\n` +
          `个人反思：${reflection.reflection}\n` +
          `最终把握度：${reflection.confidence}%\n\n` +
          "请按照完成阶段约定生成结构化学习总结、证据账本、认知偏差复盘和 AI 形成性评价。",
        state.stage
      );
    },
    [agent, isStreaming, messages.length, sendText]
  );

  const visibleMessages = useMemo(() => {
    if (!studyState) return messages.filter((message) => !isInternalHandoffMessage(message));
    if (studyState.stage === "history") {
      return messages.filter((message) => !isInternalHandoffMessage(message));
    }

    let boundaryIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      if (handoffTarget(messages[index]) === studyState.stage) {
        boundaryIndex = index;
      }
    }

    if (
      boundaryIndex < 0 &&
      localStageBoundary?.stage === studyState.stage
    ) {
      return messages
        .slice(localStageBoundary.startIndex)
        .filter((message) => !isInternalHandoffMessage(message));
    }

    // 非 history 阶段如果还没看到持久化 handoff 边界，宁可先显示空的新 Agent
    // 会话，也不要瞬间回退成完整历史；新消息到达后会由 metadata 精确恢复边界。
    if (boundaryIndex < 0) return [];

    return messages
      .slice(boundaryIndex + 1)
      .filter((message) => !isInternalHandoffMessage(message));
  }, [localStageBoundary, messages, studyState]);

  const lastAssistantId = useMemo(
    () =>
      [...visibleMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.id,
    [visibleMessages]
  );

  const completedSummaryText = useMemo(() => {
    if (studyState?.stage !== "completed") return "";
    const assistant = [...visibleMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    return assistant ? messageText(assistant) : "";
  }, [studyState?.stage, visibleMessages]);

  const medicalCase = chat.caseId ? getPublicMedicalCase(chat.caseId) : null;

  const share = async () => {
    const transcript = messages
      .map(
        (message) =>
          `${message.role === "user" ? "学生" : "教学智能体"}: ${messageText(message)}`
      )
      .join("\n\n");
    if (navigator.share) {
      await navigator.share({ title: chat.title, text: transcript });
    } else {
      await navigator.clipboard.writeText(transcript);
    }
  };

  return (
    <section className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/90 px-2 backdrop-blur md:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full md:hidden"
            onClick={onOpenSidebar}
            aria-label="打开侧栏"
          >
            <MenuIcon />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{chat.title}</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500"
                    : connectionStatus === "connecting"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              {studyState
                ? stageRoleLabel(studyState.stage)
                : connectionStatus === "connected"
                  ? "正在恢复训练状态"
                  : connectionStatus === "connecting"
                    ? "连接中"
                    : "已断开"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => void onNewChat()}
            aria-label="开始新病例训练"
          >
            <PlusIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="更多训练操作"
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void share()}>
                <Share2Icon />
                分享本次对话
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportStudyData()}>
                <DownloadIcon />
                导出研究数据
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void onDeleteChat(chat.id)}
              >
                <Trash2Icon />
                删除训练
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {studyState ? (
        <>
          <StudyControls
            state={studyState}
            disabled={isStreaming || connectionStatus !== "connected"}
            onSubmitInitial={submitInitial}
            onAdvanceEvidence={advanceEvidence}
            onAdvanceReflection={advanceReflection}
            onSubmitFinal={submitFinal}
          />
          <div className="border-b border-border/50 bg-muted/25 px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
                <StageAgentIcon stage={studyState.stage} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide">
                  {studyState.stage === "completed"
                    ? "学习总结 · 本次训练完成"
                    : `${stageRoleLabel(studyState.stage)} 已接管当前会话`}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {stageAgentDescription(studyState.stage)}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {studyState?.stage === "completed" ? (
        <StudyTraceSummary
          state={studyState}
          onExport={exportStudyData}
          exporting={exportingStudyData}
          aiSummary={completedSummaryText}
          summarizing={isStreaming}
        />
      ) : (
      <>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          key={studyState?.stage ?? "loading"}
          className="mx-auto w-full max-w-3xl gap-7 px-4 pb-4 pt-6 sm:px-6"
        >
          {visibleMessages.length === 0 ? (
            <ConversationEmptyState
              icon={<StethoscopeIcon className="size-6" />}
              title={
                studyState && studyState.stage !== "history"
                  ? `${stageRoleLabel(studyState.stage)}正在接管`
                  : "从问诊开始"
              }
              description={
                studyState && studyState.stage !== "history"
                  ? "前一位智能体的会话已收起。当前智能体会基于完整后端上下文继续工作。"
                  : medicalCase?.opening ??
                    "像面对真实患者一样逐步询问病史；只有你主动问到的信息才会披露。"
              }
              className="min-h-[46vh]"
            />
          ) : (
            visibleMessages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                isLastAssistant={message.id === lastAssistantId}
                isStreaming={isStreaming}
                onApproval={() => undefined}
              />
            ))
          )}

          {error || studyError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <div className="font-medium">这次操作没有完成</div>
              <div className="mt-1 break-words text-xs opacity-80">
                {error?.message ?? studyError}
              </div>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <StudyComposer
        draft={draft}
        placeholder={
          studyState ? stagePlaceholder(studyState.stage) : "正在恢复训练状态…"
        }
        isStreaming={isStreaming}
        hasError={Boolean(error || studyError)}
        disabled={
          connectionStatus !== "connected" || !studyState
        }
        onDraftChange={setDraft}
        onSend={sendText}
        onStop={stop}
      />
      </>
      )}
    </section>
  );
}

