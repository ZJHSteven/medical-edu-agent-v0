import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments
} from "@/components/ai-elements/attachments";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from "@/components/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger
} from "@/components/ai-elements/sources";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  XIcon
} from "lucide-react";
import { useMemo, useState } from "react";

type ChatMessageViewProps = {
  message: UIMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onEditUser?: (text: string) => void;
  onApproval: (approvalId: string, approved: boolean) => void;
};

function getPlainText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * AI Elements 的消息渲染器。
 *
 * Think 返回的是 AI SDK UIMessage parts，因此不需要再造一层自定义协议：
 * text → MessageResponse（完整 Markdown/代码/数学/mermaid）
 * reasoning → Reasoning 折叠栏
 * tool-* → Tool trace
 * source-url → Sources
 * file → Attachments
 */
export function ChatMessageView({
  message,
  isLastAssistant,
  isStreaming,
  onRegenerate,
  onEditUser,
  onApproval
}: ChatMessageViewProps) {
  const [copied, setCopied] = useState(false);
  const sourceParts = useMemo(
    () => message.parts.filter((part) => part.type === "source-url"),
    [message.parts]
  );
  const fileParts = useMemo(
    () => message.parts.filter((part) => part.type === "file"),
    [message.parts]
  );
  const plainText = getPlainText(message);

  const copy = async () => {
    await navigator.clipboard.writeText(plainText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Message from={message.role} className="max-w-full">
      <MessageContent className="max-w-full">
        {fileParts.length > 0 ? (
          <Attachments variant="list" className="mb-2 max-w-full">
            {fileParts.map((part, index) => (
              <Attachment
                key={`${message.id}-file-${index}`}
                data={{ ...part, id: `${message.id}-file-${index}` }}
                className="max-w-full"
              >
                <AttachmentPreview />
                <AttachmentInfo />
              </Attachment>
            ))}
          </Attachments>
        ) : null}

        {message.parts.map((part, index) => {
          if (part.type === "text") {
            if (!part.text && !(isLastAssistant && isStreaming)) return null;
            return (
              <MessageResponse
                key={`${message.id}-text-${index}`}
                isAnimating={isLastAssistant && isStreaming}
              >
                {part.text || " "}
              </MessageResponse>
            );
          }

          if (part.type === "reasoning") {
            if (!part.text && part.state !== "streaming") return null;
            return (
              <Reasoning
                key={`${message.id}-reasoning-${index}`}
                isStreaming={
                  isLastAssistant && isStreaming && part.state === "streaming"
                }
                className="my-2"
              >
                <ReasoningTrigger
                  getThinkingMessage={(streaming, duration) =>
                    streaming
                      ? "正在思考…"
                      : duration
                        ? `思考了 ${duration} 秒`
                        : "思考过程"
                  }
                />
                <ReasoningContent>{part.text || " "}</ReasoningContent>
              </Reasoning>
            );
          }

          if (!isToolUIPart(part)) return null;
          const toolName = getToolName(part);
          const approvalId =
            "approval" in part && typeof part.approval === "object" && part.approval
              ? (part.approval as { id?: string }).id
              : undefined;

          return (
            <Tool key={part.toolCallId} className="my-2 max-w-2xl">
              {part.type === "dynamic-tool" ? (
                <ToolHeader
                  type="dynamic-tool"
                  toolName={toolName}
                  state={part.state}
                  title={toolName}
                />
              ) : (
                <ToolHeader
                  type={part.type}
                  state={part.state}
                  title={toolName}
                />
              )}
              <ToolContent>
                {part.input != null ? <ToolInput input={part.input} /> : null}
                <ToolOutput
                  output={"output" in part ? part.output : undefined}
                  errorText={"errorText" in part ? part.errorText : undefined}
                />
                {part.state === "approval-requested" && approvalId ? (
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onApproval(approvalId, true)}
                    >
                      <CheckIcon data-icon="inline-start" />
                      允许
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApproval(approvalId, false)}
                    >
                      <XIcon data-icon="inline-start" />
                      拒绝
                    </Button>
                  </div>
                ) : null}
              </ToolContent>
            </Tool>
          );
        })}

        {sourceParts.length > 0 ? (
          <Sources className="mt-2">
            <SourcesTrigger count={sourceParts.length}>
              使用了 {sourceParts.length} 个来源
            </SourcesTrigger>
            <SourcesContent>
              {sourceParts.map((source, index) => (
                <Source
                  key={`${message.id}-source-${index}`}
                  href={source.url}
                  title={source.title ?? source.url}
                />
              ))}
            </SourcesContent>
          </Sources>
        ) : null}
      </MessageContent>

      <MessageActions
        className={
          message.role === "user"
            ? "justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            : "opacity-70 transition-opacity hover:opacity-100"
        }
      >
        {plainText ? (
          <MessageAction
            tooltip={copied ? "已复制" : "复制"}
            label="复制消息"
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </MessageAction>
        ) : null}
        {message.role === "user" && onEditUser ? (
          <MessageAction
            tooltip="编辑并重新发送"
            label="编辑消息"
            onClick={() => onEditUser(plainText)}
          >
            <PencilIcon />
          </MessageAction>
        ) : null}
        {message.role === "assistant" && onRegenerate ? (
          <MessageAction
            tooltip="重新生成"
            label="重新生成"
            disabled={isStreaming}
            onClick={onRegenerate}
          >
            <RefreshCwIcon />
          </MessageAction>
        ) : null}
      </MessageActions>
    </Message>
  );
}
