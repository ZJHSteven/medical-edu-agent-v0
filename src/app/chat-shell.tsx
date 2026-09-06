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
import type { FileUIPart, UIMessage } from "ai";
import {
  ArchiveIcon,
  FolderPlusIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Share2Icon,
  SparklesIcon,
  Trash2Icon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentConfig,
  ChatSummary,
  UsageSummary
} from "../../agents/assistant/types";
import {
  DEFAULT_MODEL_ROUTE_ID,
  getModelRoute,
  type ReasoningEffort
} from "../../shared/model-catalog";
import { ChatComposer } from "./chat-composer";
import { ChatMessageView } from "./message-view";

type ChatShellProps = {
  chat: ChatSummary;
  onOpenSidebar: () => void;
  onNewChat: () => void | Promise<void>;
  onDeleteChat: (chatId: string) => void | Promise<void>;
  initialTurn?: {
    text: string;
    files: FileUIPart[];
    config: AgentConfig;
  } | null;
  onInitialTurnConsumed?: () => void;
};

const DEFAULT_CONFIG: AgentConfig = {
  modelRouteId: DEFAULT_MODEL_ROUTE_ID,
  reasoningEffort: getModelRoute(DEFAULT_MODEL_ROUTE_ID).defaultReasoningEffort,
  persona: ""
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * 单个聊天的完整 ChatGPT 风格工作区。
 *
 * Agent 连接仍然沿用官方 Assistant 的安全子路由：浏览器只连接当前用户的
 * AssistantDirectory，再以 sub-agent facet 打开具体 MyAssistant chatId。
 */
export function ChatShell({
  chat,
  onOpenSidebar,
  onNewChat,
  onDeleteChat,
  initialTurn,
  onInitialTurnConsumed
}: ChatShellProps) {
  const [draft, setDraft] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const initialTurnStarted = useRef(false);

  const agent = useAgent({
    agent: "AssistantDirectory",
    basePath: "chat",
    sub: [{ agent: "MyAssistant", name: chat.id }],
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
    onClose: useCallback(() => setConnectionStatus("disconnected"), []),
    onError: useCallback((event: Event) => {
      console.error("Family AI WebSocket error", event);
      setConnectionStatus("disconnected");
    }, [])
  });

  const {
    messages,
    sendMessage,
    regenerate,
    addToolApprovalResponse,
    stop,
    isStreaming,
    error,
    clearError
  } = useAgentChat({
    agent,
    // 2026-09-06: Cloudflare Agents 的 resumable replay 与 AI SDK 7 的
    // UIMessageStream framing 目前仍存在边界问题：恢复流可能让客户端看到
    // `text-delta` 时对应 `text-start` 不在本次消费状态里，从而触发
    // AI_UIMessageStreamError。普通 live stream 已分别在何一位原始 Responses
    // SSE 和当前 @ai-sdk/openai 归一化层验证过 start/delta/end 顺序正常。
    // 在上游 replay 协议稳定前，产品优先保证正常聊天可用；关闭的只是浏览器
    // 断线后的自动续流，不影响服务端持久化、正常实时流或后续重新打开聊天。
    resume: false,
    experimental_throttle: 80,
    getInitialMessages: null,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName === "getUserTimezone") {
        addToolOutput({
          toolCallId: toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleString()
          }
        });
      }
    }
  });

  const refreshConfig = useCallback(async () => {
    try {
      const value = (await agent.call("currentConfig", [])) as AgentConfig;
      setConfig(value);
    } catch (reason) {
      console.warn("Failed to read agent config", reason);
    }
  }, [agent]);

  const refreshUsage = useCallback(async () => {
    try {
      const value = (await agent.call("getUsageSummary", [])) as UsageSummary;
      setUsage(value);
    } catch (reason) {
      console.warn("Failed to read usage summary", reason);
    }
  }, [agent]);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    void refreshConfig();
    void refreshUsage();
  }, [connectionStatus, chat.id, refreshConfig, refreshUsage]);

  // A draft becomes a real sub-agent only after the first user submission.
  // Once its child WebSocket is connected, replay that pending first turn
  // exactly once, including the model selection made while it was still local.
  useEffect(() => {
    if (
      !initialTurn ||
      initialTurnStarted.current ||
      connectionStatus !== "connected"
    ) {
      return;
    }

    initialTurnStarted.current = true;
    void (async () => {
      try {
        const normalized = (await agent.call("updateConfig", [
          initialTurn.config
        ])) as AgentConfig;
        setConfig(normalized);
        const parts: UIMessage["parts"] = [];
        if (initialTurn.text) {
          parts.push({ type: "text", text: initialTurn.text });
        }
        parts.push(...initialTurn.files);
        sendMessage({ role: "user", parts });
        onInitialTurnConsumed?.();
      } catch (reason) {
        initialTurnStarted.current = false;
        console.error("Failed to submit initial draft turn", reason);
      }
    })();
  }, [
    agent,
    connectionStatus,
    initialTurn,
    onInitialTurnConsumed,
    sendMessage
  ]);

  // 一轮结束后再读一次 usage ledger，保证上下文环和费用同步到最新 step。
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (isStreaming || connectionStatus !== "connected") return;
    void refreshUsage();
  }, [isStreaming, latestMessageId, connectionStatus, refreshUsage]);

  const updateModel = useCallback(
    async (value: {
      routeId: string;
      reasoningEffort: ReasoningEffort;
    }) => {
      const next: AgentConfig = {
        ...config,
        modelRouteId: value.routeId,
        reasoningEffort: value.reasoningEffort
      };
      // 乐观更新让选择器立即响应；Worker 会再次 normalize 并返回最终结果。
      setConfig(next);
      try {
        const normalized = (await agent.call("updateConfig", [next])) as AgentConfig;
        setConfig(normalized);
      } catch (reason) {
        console.error("Failed to update model config", reason);
        await refreshConfig();
      }
    },
    [agent, config, refreshConfig]
  );

  const send = useCallback(
    async (text: string, files: FileUIPart[]) => {
      if (isStreaming) return;
      clearError();
      const parts: UIMessage["parts"] = [];
      if (text) parts.push({ type: "text", text });
      parts.push(...files);
      setDraft("");
      sendMessage({ role: "user", parts });
    },
    [clearError, isStreaming, sendMessage]
  );

  const approve = useCallback(
    (approvalId: string, approved: boolean) => {
      addToolApprovalResponse({ id: approvalId, approved });
    },
    [addToolApprovalResponse]
  );

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages]
  );

  const share = async () => {
    const transcript = messages
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${messageText(message)}`)
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
            <div className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex">
              <span
                className={`size-1.5 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500"
                    : connectionStatus === "connecting"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              {connectionStatus === "connected"
                ? "已连接"
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
            aria-label="新聊天"
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
                  aria-label="更多聊天操作"
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void share()}>
                <Share2Icon />
                分享
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <FolderPlusIcon />
                添加到项目
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <SearchIcon />
                在聊天中查找
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <ArchiveIcon />
                归档
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void onDeleteChat(chat.id)}
              >
                <Trash2Icon />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-7 px-4 pb-4 pt-6 sm:px-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<SparklesIcon className="size-6" />}
              title="有什么可以帮你的？"
              description="可以聊天、搜索网页、上传图片或文件，也可以让工具处理你的工作。"
              className="min-h-[52vh]"
            />
          ) : (
            messages.map((message) => (
              <ChatMessageView
                key={message.id}
                message={message}
                isLastAssistant={message.id === lastAssistantId}
                isStreaming={isStreaming}
                onApproval={approve}
                onEditUser={
                  message.role === "user"
                    ? (text) => setDraft(text)
                    : undefined
                }
                onRegenerate={
                  message.role === "assistant" && message.id === lastAssistantId
                    ? () => {
                        if (!isStreaming) {
                          clearError();
                          regenerate();
                        }
                      }
                    : undefined
                }
              />
            ))
          )}

          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <div className="font-medium">这次请求没有完成</div>
              <div className="mt-1 break-words text-xs opacity-80">
                {error.message}
              </div>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <ChatComposer
        draft={draft}
        routeId={config.modelRouteId}
        reasoningEffort={config.reasoningEffort}
        usage={usage}
        isStreaming={isStreaming}
        hasError={Boolean(error)}
        disabled={connectionStatus !== "connected"}
        onDraftChange={setDraft}
        onSend={send}
        onStop={stop}
        onModelChange={updateModel}
      />
    </section>
  );
}
