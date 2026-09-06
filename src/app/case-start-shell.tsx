import { Button } from "@/components/ui/button";
import { MenuIcon, StethoscopeIcon, TimerIcon } from "lucide-react";
import { useState } from "react";
import { PUBLIC_MEDICAL_CASES } from "../../shared/medical-cases";

type CaseStartShellProps = {
  onOpenSidebar: () => void;
  onStartCase: (caseId: string) => void | Promise<void>;
};

/**
 * “新聊天”在医学实验里没有意义，因此首页直接变成病例入口。
 *
 * 这里只消费 `shared/medical-cases.ts` 的公开字段；标准答案完全不会被打进
 * 浏览器 bundle。第一版只有一个病例，但布局按多病例目录设计，后续加病例
 * 不需要改页面逻辑。
 */
export function CaseStartShell({ onOpenSidebar, onStartCase }: CaseStartShellProps) {
  const [startingCaseId, setStartingCaseId] = useState<string | null>(null);

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
        <span className="ml-1 text-sm font-medium">医学临床推理训练</span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-10 sm:px-8 sm:py-16">
          <div className="mb-8 max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <StethoscopeIcon className="size-3.5" />
              多智能体医学教育 Demo
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              从问诊开始完成一次临床推理
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              训练会按“问诊实践 → 临床反馈 → 循证拓展 → 反思修订”依次进行。
              系统会记录过程数据用于教学研究；请按自己的真实思路作答。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {PUBLIC_MEDICAL_CASES.map((medicalCase) => (
              <article
                key={medicalCase.id}
                className="flex min-h-56 flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold">{medicalCase.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {medicalCase.level}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <TimerIcon className="size-3.5" />
                    约 {medicalCase.estimatedMinutes} 分钟
                  </div>
                </div>

                <p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground">
                  {medicalCase.opening}
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {medicalCase.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <Button
                  type="button"
                  className="mt-5 w-full rounded-xl"
                  disabled={startingCaseId !== null}
                  onClick={async () => {
                    setStartingCaseId(medicalCase.id);
                    try {
                      await onStartCase(medicalCase.id);
                    } finally {
                      setStartingCaseId(null);
                    }
                  }}
                >
                  {startingCaseId === medicalCase.id ? "正在创建训练…" : "开始训练"}
                </Button>
              </article>
            ))}
          </div>
        </div>
      </main>
    </section>
  );
}

