import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage
} from "@/components/ai-elements/prompt-input";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import type { FileUIPart } from "ai";
import { MicIcon } from "lucide-react";
import type { ReasoningEffort } from "../../shared/model-catalog";
import type { UsageSummary } from "../../agents/assistant/types";
import { ModelPicker } from "./model-picker";
import { UsageCaption, UsageIndicator } from "./usage-indicator";

type ChatComposerProps = {
  draft: string;
  routeId: string;
  reasoningEffort: ReasoningEffort;
  usage: UsageSummary | null;
  isStreaming: boolean;
  hasError: boolean;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSend: (text: string, files: FileUIPart[]) => void | Promise<void>;
  onStop: () => void;
  onModelChange: (value: {
    routeId: string;
    reasoningEffort: ReasoningEffort;
  }) => void | Promise<void>;
};

/** PromptInput 内部附件状态的可视化。 */
function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <Attachments variant="inline" className="w-full flex-wrap px-1 pt-1">
      {attachments.files.map((file) => (
        <Attachment key={file.id} data={file} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

/**
 * 固定在聊天底部的 ChatGPT 风格输入器。
 * AI Elements 自己负责文件选择、拖拽、Blob→DataURL 与提交前清理；本组件只把
 * 生成好的 FileUIPart 原样交给 Think 的 useAgentChat.sendMessage。
 */
export function ChatComposer({
  draft,
  routeId,
  reasoningEffort,
  usage,
  isStreaming,
  hasError,
  disabled,
  onDraftChange,
  onSend,
  onStop,
  onModelChange
}: ChatComposerProps) {
  const submit = async (message: PromptInputMessage) => {
    if (!message.text.trim() && message.files.length === 0) return;
    await onSend(message.text.trim(), message.files);
  };

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 w-full bg-gradient-to-t from-background via-background/95 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 sm:px-5">
      <div className="pointer-events-auto mx-auto w-full max-w-3xl">
        <PromptInput
          multiple
          globalDrop
          maxFiles={8}
          maxFileSize={20 * 1024 * 1024}
          onSubmit={submit}
          onError={(error) => console.warn("Attachment rejected:", error.message)}
          className="rounded-[24px] border border-border/80 bg-background shadow-lg shadow-black/5"
        >
          <PromptInputHeader className="px-2 pt-2">
            <ComposerAttachments />
          </PromptInputHeader>

          <PromptInputBody>
            <PromptInputTextarea
              name="message"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="给 Family AI 发消息"
              disabled={disabled}
              // iOS Safari 会在聚焦小于 16px 的 input/textarea 时自动放大页面。
              // 手机端保持 16px，桌面端再回到原先更紧凑的 15px，既避免自动缩放，
              // 又不牺牲桌面聊天输入框的视觉密度。
              className="min-h-14 max-h-48 px-4 py-3 text-base leading-6 sm:text-[15px]"
            />
          </PromptInputBody>

          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="添加照片或文件" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments label="添加照片或文件" />
                  <PromptInputActionAddScreenshot label="截取屏幕" />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>

              <ModelPicker
                routeId={routeId}
                reasoningEffort={reasoningEffort}
                disabled={isStreaming || disabled}
                onChange={onModelChange}
              />

              <UsageIndicator usage={usage} />
            </PromptInputTools>

            <PromptInputTools>
              <SpeechInput
                lang="zh-CN"
                variant="ghost"
                size="icon-sm"
                aria-label="语音输入"
                title="语音输入"
                onTranscriptionChange={(text) =>
                  onDraftChange(`${draft}${draft && !draft.endsWith(" ") ? " " : ""}${text}`)
                }
              >
                <MicIcon />
              </SpeechInput>

              <PromptInputSubmit
                status={
                  isStreaming
                    ? "streaming"
                    : hasError
                      ? "error"
                      : "ready"
                }
                onStop={onStop}
                disabled={disabled || (!isStreaming && !draft.trim())}
                className="rounded-full"
              />
            </PromptInputTools>
          </PromptInputFooter>
        </PromptInput>

        <div className="mt-1.5 hidden min-h-4 items-center justify-center text-center text-[10px] text-muted-foreground sm:flex">
          <UsageCaption usage={usage} />
        </div>
      </div>
    </div>
  );
}
