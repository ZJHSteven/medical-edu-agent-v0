import {
  Conversation,
  ConversationContent,
  ConversationEmptyState
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import type { FileUIPart } from "ai";
import { MenuIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import type { AgentConfig } from "../../agents/assistant/types";
import {
  DEFAULT_MODEL_ROUTE_ID,
  getModelRoute,
  type ReasoningEffort
} from "../../shared/model-catalog";
import { ChatComposer } from "./chat-composer";

type DraftChatShellProps = {
  onOpenSidebar: () => void;
  onMaterialize: (
    text: string,
    files: FileUIPart[],
    config: AgentConfig
  ) => void | Promise<void>;
};

const DEFAULT_DRAFT_CONFIG: AgentConfig = {
  modelRouteId: DEFAULT_MODEL_ROUTE_ID,
  reasoningEffort: getModelRoute(DEFAULT_MODEL_ROUTE_ID).defaultReasoningEffort,
  persona: ""
};

/**
 * A local-only conversation draft. No sub-agent/facet exists until the first
 * message is submitted, so refreshing or repeatedly pressing “New chat” can
 * never pollute the Durable Object registry with empty conversations.
 */
export function DraftChatShell({
  onOpenSidebar,
  onMaterialize
}: DraftChatShellProps) {
  const [draft, setDraft] = useState("");
  const [config, setConfig] = useState(DEFAULT_DRAFT_CONFIG);
  const [submitting, setSubmitting] = useState(false);

  const updateModel = (value: {
    routeId: string;
    reasoningEffort: ReasoningEffort;
  }) => {
    setConfig((current) => ({
      ...current,
      modelRouteId: value.routeId,
      reasoningEffort: value.reasoningEffort
    }));
  };

  return (
    <section className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="z-30 flex h-14 shrink-0 items-center border-b border-border/50 bg-background/90 px-2 backdrop-blur md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={onOpenSidebar}
          aria-label="打开侧栏"
        >
          <MenuIcon />
        </Button>
        <span className="ml-1 text-sm font-medium">Family AI</span>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4 pb-4 pt-6 sm:px-6">
          <ConversationEmptyState
            icon={<SparklesIcon className="size-6" />}
            title="有什么可以帮你的？"
            description="发送第一条消息后才会创建并保存这个聊天。"
            className="min-h-[52vh]"
          />
        </ConversationContent>
      </Conversation>

      <ChatComposer
        draft={draft}
        routeId={config.modelRouteId}
        reasoningEffort={config.reasoningEffort}
        usage={null}
        isStreaming={submitting}
        hasError={false}
        disabled={submitting}
        onDraftChange={setDraft}
        onSend={async (text, files) => {
          setSubmitting(true);
          try {
            await onMaterialize(text, files, config);
          } finally {
            setSubmitting(false);
          }
        }}
        onStop={() => undefined}
        onModelChange={updateModel}
      />
    </section>
  );
}
