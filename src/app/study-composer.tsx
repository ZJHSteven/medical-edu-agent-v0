import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage
} from "@/components/ai-elements/prompt-input";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import { MicIcon } from "lucide-react";

type StudyComposerProps = {
  draft: string;
  placeholder: string;
  isStreaming: boolean;
  hasError: boolean;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
};

/**
 * 医学实验专用输入器。
 *
 * 仍然使用 AI Elements 的 PromptInput 和 SpeechInput，但主动去掉文件附件、
 * 模型选择、费用、Workspace 等实验无关入口。这样 UI 视觉完全沿用 Family AI，
 * 同时减少“不同学生用了不同额外功能”造成的干预不一致。
 */
export function StudyComposer({
  draft,
  placeholder,
  isStreaming,
  hasError,
  disabled,
  onDraftChange,
  onSend,
  onStop
}: StudyComposerProps) {
  const submit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text) return;
    await onSend(text);
  };

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 w-full bg-gradient-to-t from-background via-background/95 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 sm:px-5">
      <div className="pointer-events-auto mx-auto w-full max-w-3xl">
        <PromptInput
          onSubmit={submit}
          className="rounded-[24px] border border-border/80 bg-background shadow-lg shadow-black/5"
        >
          <PromptInputBody>
            <PromptInputTextarea
              name="message"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="min-h-14 max-h-48 px-4 py-3 text-base leading-6 sm:text-[15px]"
            />
          </PromptInputBody>

          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <span className="px-2 text-[11px] text-muted-foreground">
                请按自己的真实思路作答
              </span>
            </PromptInputTools>
            <PromptInputTools>
              <SpeechInput
                lang="zh-CN"
                variant="ghost"
                size="icon-sm"
                aria-label="语音输入"
                title="语音输入"
                onTranscriptionChange={(text) =>
                  onDraftChange(
                    `${draft}${draft && !draft.endsWith(" ") ? " " : ""}${text}`
                  )
                }
              >
                <MicIcon />
              </SpeechInput>
              <PromptInputSubmit
                status={
                  isStreaming ? "streaming" : hasError ? "error" : "ready"
                }
                onStop={onStop}
                disabled={disabled || (!isStreaming && !draft.trim())}
                className="rounded-full"
              />
            </PromptInputTools>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

