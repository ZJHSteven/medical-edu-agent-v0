import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import "@/styles.css";

const MODES = ["cmdk-blur", "cmdk-flat", "native-blur", "native-flat"] as const;
type Mode = (typeof MODES)[number];

const PROVIDERS = ["openai", "deepseek", "openai"];
const MODELS = Array.from({ length: 25 }, (_, index) => ({
  id: `model-${index + 1}`,
  provider: PROVIDERS[index % PROVIDERS.length],
  name: index % 3 === 0 ? "5.6 Luna" : index % 3 === 1 ? "5.6 Terra" : "5.6 Sol",
  group: ["混池", "Plus", "企业", "炸弹", "官方"][index % 5]
}));

function getMode(): Mode {
  const requested = new URLSearchParams(location.search).get("mode") as Mode | null;
  return requested && MODES.includes(requested) ? requested : "cmdk-blur";
}

function Row({ model }: { model: (typeof MODELS)[number] }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <img
        src={`https://models.dev/logos/${model.provider}.svg`}
        alt=""
        className="size-3 shrink-0 dark:invert"
        width={12}
        height={12}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{model.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          合一位 · {model.group} · 成功 88% · Cache 82%
        </div>
      </div>
    </div>
  );
}

function CmdkList() {
  return (
    <Command className="h-full rounded-xl">
      <CommandInput data-bench-search placeholder="搜索模型…" />
      <CommandList className="max-h-[520px]">
        <CommandEmpty>没有匹配模型</CommandEmpty>
        <CommandGroup heading="模型">
          {MODELS.map((model) => (
            <CommandItem
              data-bench-item
              key={model.id}
              value={`${model.name} ${model.group}`}
              className="py-2.5"
            >
              <Row model={model} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function NativeList() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MODELS;
    return MODELS.filter((model) =>
      `${model.name} ${model.group}`.toLowerCase().includes(needle)
    );
  }, [query]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
      <div className="border-b p-2">
        <input
          data-bench-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模型…"
          className="h-9 w-full rounded-lg bg-muted/60 px-3 text-sm outline-none"
        />
      </div>
      <div className="max-h-[520px] overflow-y-auto p-1">
        {filtered.map((model) => (
          <button
            data-bench-item
            key={model.id}
            type="button"
            className="flex w-full items-center rounded-lg px-2 py-2.5 text-left hover:bg-muted focus:bg-muted focus:outline-none"
          >
            <Row model={model} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Background() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="h-14 rounded-2xl bg-muted/70" />
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="space-y-2 rounded-2xl border p-4">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted/70" />
            <div className="h-4 w-5/6 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Bench() {
  const mode = getMode();
  const useCmdk = mode.startsWith("cmdk");
  const useBlur = mode.endsWith("blur");

  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      <Background />
      <div
        data-bench-overlay
        className={`absolute inset-0 bg-black/10 ${useBlur ? "backdrop-blur-sm" : ""}`}
      />
      <section
        data-bench-panel
        className="absolute left-1/2 top-1/2 h-[620px] w-[620px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-popover shadow-2xl ring-1 ring-foreground/10"
      >
        <div className="flex h-12 items-center justify-between border-b px-4 text-xs text-muted-foreground">
          <span>模式：{mode}</span>
          <span>25 models · 25 SVG logos</span>
        </div>
        <div className="h-[568px]">{useCmdk ? <CmdkList /> : <NativeList />}</div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
