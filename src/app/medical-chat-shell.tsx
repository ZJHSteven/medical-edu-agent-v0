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
  MenuIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Share2Icon,
  StethoscopeIcon,
  Trash2Icon
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

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    void refreshStudyState();
  }, [connectionStatus, chat.id, refreshStudyState]);

  const sendText = useCallback(
    (text: string) => {
      if (isStreaming || !text.trim()) return;
      clearError();
      setDraft("");
      sendMessage({
        role: "user",
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
      setStudyState(state);
      sendText(
        `【第一次临床判断】\n最可能诊断：${assessment.primaryDiagnosis}\n` +
          `鉴别诊断：${assessment.differentials}\n` +
          `推理依据：${assessment.reasoning}\n` +
          `当前把握度：${assessment.confidence}%\n\n` +
          "请作为临床导师针对我的推理过程给予反馈，不要直接替我完成最终答案。"
      );
    },
    [agent, isStreaming, sendText]
  );

  const advanceEvidence = useCallback(async () => {
    if (isStreaming) return;
    const state = (await agent.call("advanceToEvidence", [])) as StudyState;
    setStudyState(state);
    sendText(
      "我准备进入循证拓展阶段。请作为科研导师，根据当前病例和前面的推理，帮助我把关键不确定性转化成可检索的循证问题，并检索真实文献证据。"
    );
  }, [agent, isStreaming, sendText]);

  const advanceReflection = useCallback(async () => {
    if (isStreaming) return;
    const state = (await agent.call("advanceToReflection", [])) as StudyState;
    setStudyState(state);
    sendText(
      "我已经完成本轮循证拓展。请帮助我比较最初判断、临床反馈和检索到的证据，提示我应该重点反思哪些变化，但不要替我写最终反思。"
    );
  }, [agent, isStreaming, sendText]);

  const submitFinal = useCallback(
    async (reflection: FinalReflection) => {
      if (isStreaming) return;
      const state = (await agent.call("submitFinalReflection", [
        reflection
      ])) as StudyState;
      setStudyState(state);
      sendMessage({
        role: "user",
        parts: [
          {
            type: "text",
            text:
              `【最终判断与反思】\n最终诊断：${reflection.finalDiagnosis}\n` +
              `修订后的推理：${reflection.revisedReasoning}\n` +
              `循证信息的影响：${reflection.evidenceImpact}\n` +
              `个人反思：${reflection.reflection}\n` +
              `最终把握度：${reflection.confidence}%\n\n` +
              "请给出简短学习总结。"
          }
        ]
      });
    },
    [agent, isStreaming, sendMessage]
  );

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages]
  );

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
        <StudyControls
          state={studyState}
          disabled={isStreaming || connectionStatus !== "connected"}
          onSubmitInitial={submitInitial}
          onAdvanceEvidence={advanceEvidence}
          onAdvanceReflection={advanceReflection}
          onSubmitFinal={submitFinal}
        />
      ) : null}

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-7 px-4 pb-4 pt-6 sm:px-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<StethoscopeIcon className="size-6" />}
              title="从问诊开始"
              description={
                medicalCase?.opening ??
                "像面对真实患者一样逐步询问病史；只有你主动问到的信息才会披露。"
              }
              className="min-h-[46vh]"
            />
          ) : (
            messages.map((message) => (
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
          connectionStatus !== "connected" ||
          !studyState ||
          studyState.stage === "completed"
        }
        onDraftChange={setDraft}
        onSend={sendText}
        onStop={stop}
      />
    </section>
  );
}

