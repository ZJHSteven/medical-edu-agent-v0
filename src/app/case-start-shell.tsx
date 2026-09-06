import { Button } from "@/components/ui/button";
import { MenuIcon, StethoscopeIcon, TimerIcon } from "lucide-react";
import { useState } from "react";
import { PUBLIC_MEDICAL_CASES } from "../../shared/medical-cases";

type CaseStartShellProps = {
  onOpenSidebar: () => void;
  onStartCase: (caseId: string) => void | Promise<void>;
};

const CASE_SERIES = Array.from(
  PUBLIC_MEDICAL_CASES.reduce((groups, medicalCase) => {
    const existing = groups.get(medicalCase.seriesId) ?? {
      id: medicalCase.seriesId,
      title: medicalCase.seriesTitle,
      cases: [] as typeof PUBLIC_MEDICAL_CASES
    };
    existing.cases.push(medicalCase);
    groups.set(medicalCase.seriesId, existing);
    return groups;
  }, new Map<string, { id: string; title: string; cases: typeof PUBLIC_MEDICAL_CASES }>()).values()
).map((series) => ({
  ...series,
  cases: [...series.cases].sort((a, b) => a.act - b.act)
}));

/**
 * “新聊天”在医学实验里没有意义，因此首页直接变成病例入口。
 *
 * 这里只消费 `shared/medical-cases.ts` 的公开字段；标准答案完全不会被打进
 * 浏览器 bundle。首页按“病例系列”分组，同一患者的三幕纵向病程分别作为
 * 独立训练单元启动，避免把三幕误解为三个不同患者。
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

          <div className="space-y-5">
            {CASE_SERIES.map((series) => (
              <section
                key={series.id}
                className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
              >
                <div className="border-b border-border/70 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold sm:text-lg">{series.title}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        同一患者的三幕纵向病例 · 可从任一幕独立进入训练
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                      3 个训练单元
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-border/60">
                  {series.cases.map((medicalCase) => (
                    <article
                      key={medicalCase.id}
                      className="grid gap-4 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <div className="text-sm font-semibold sm:text-base">
                            {medicalCase.title}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <TimerIcon className="size-3.5" />
                            约 {medicalCase.estimatedMinutes} 分钟
                          </div>
                        </div>

                        <div className="mt-1 text-xs text-muted-foreground">
                          {medicalCase.level}
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                          {medicalCase.opening}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {medicalCase.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full rounded-xl md:w-28"
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
                        {startingCaseId === medicalCase.id ? "创建中…" : `进入第${medicalCase.act}幕`}
                      </Button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </section>
  );
}

