import { DurableObject } from "cloudflare:workers";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";

type Env = {
  PiBenchAgent: DurableObjectNamespace<PiBenchAgent>;
  PiBenchDirectory: DurableObjectNamespace<PiBenchDirectory>;
};

type BenchMode = "history" | "tool";

const HISTORY_TEXT =
  "HISTORY_BENCH " +
  "The simulated patient describes symptoms in chronological order with clinically relevant detail. ".repeat(150);

const TOOL_FINAL_TEXT =
  "TOOL_BENCH_FINAL " +
  "The evidence mentor integrates the retrieved evidence and explains how it changes the differential diagnosis. ".repeat(90);

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

/**
 * One benchmark training session = one Durable Object.
 *
 * The benchmark intentionally uses Pi's faux provider:
 * - output length and tool rounds are deterministic;
 * - there is no provider-network variance or API-key dependency;
 * - Durable Object storage/request/CPU metrics therefore describe the harness itself.
 */
export class PiBenchAgent extends DurableObject<Env> {
  private readonly faux = fauxProvider({
    provider: "medical-bench-faux",
    tokensPerSecond: 1_000,
    tokenSize: { min: 1, max: 2 },
  });
  private readonly models = createModels();
  private readonly registry = createRegistry();

  private readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) =>
      Harness.open(
        storage,
        {
          models: this.models,
          registry: this.registry,
          onWake,
          settings: {
            progress: {
              partialIntervalMs: 50,
              outputIntervalMs: 50,
              // Core experiment: live progress stays observable in-memory,
              // while time-based persistence is disabled.
              persistWithinMs: Infinity,
            },
          },
        },
        context,
      ),
    defaults: {
      model: this.faux.getModel(),
      thinkingLevel: "high",
      maxTurns: 4,
    },
  });

  private readonly lifecycle = Lifecycle.install(this).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.models.setProvider(this.faux.provider);

    const owner = this;
    const evidenceTool = defineTool({
      name: "bench_evidence",
      description: "Return deterministic evidence text for the storage benchmark.",
      parameters: obj({ query: str() }),
      replay: "safe",
      async execute(input) {
        owner.appendEvent("tool_call", { tool: "bench_evidence", query: input.query });
        const text =
          "BENCH_EVIDENCE_RESULT: TRAb supports Graves disease; uptake patterns distinguish destructive thyroiditis.";
        owner.appendEvent("tool_result", { tool: "bench_evidence", chars: text.length });
        return { output: [{ type: "text" as const, text }] };
      },
    });

    this.registry.install(
      defineExtension({
        name: "medical-bench",
        tools: [evidenceTool],
      }),
    );

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS study_state (
        id INTEGER PRIMARY KEY,
        stage TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS study_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO study_state (id, stage, updated_at) VALUES (1, 'history', ?)",
      Date.now(),
    );
  }

  async run(mode: BenchMode) {
    const before = this.totalChanges();
    const startedAt = Date.now();

    if (mode === "history") {
      this.faux.setResponses([fauxAssistantMessage(HISTORY_TEXT)]);
      this.appendEvent("user_message", { mode, text: "history benchmark prompt" });
      const result = await this.harness.prompt(
        "Please describe your main symptoms in detail and in chronological order.",
      );
      this.appendEvent("assistant_message", { mode, chars: result.text.length });
      return this.finish(mode, result.text, startedAt, before);
    }

    if (mode === "tool") {
      this.ctx.storage.sql.exec(
        "UPDATE study_state SET stage = 'evidence', updated_at = ? WHERE id = 1",
        Date.now(),
      );
      this.faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("bench_evidence", { query: "TRAb diagnostic accuracy" }, { id: "bench-tool-1" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxText(TOOL_FINAL_TEXT)]),
      ]);
      this.appendEvent("user_message", { mode, text: "evidence benchmark prompt" });
      const result = await this.harness.prompt(
        "Use bench_evidence exactly once, then explain how the evidence changes the diagnosis.",
      );
      this.appendEvent("assistant_message", { mode, chars: result.text.length });
      return this.finish(mode, result.text, startedAt, before);
    }

    throw new Error("unknown benchmark mode");
  }

  diagnostics() {
    const [state] = this.ctx.storage.sql
      .exec<{ stage: string; updated_at: number }>(
        "SELECT stage, updated_at FROM study_state WHERE id = 1",
      )
      .toArray();
    const [events] = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM study_events")
      .toArray();
    return {
      state,
      eventCount: events?.count ?? 0,
      sqliteTotalChanges: this.totalChanges(),
    };
  }

  private finish(mode: BenchMode, text: string, startedAt: number, before: number) {
    return {
      mode,
      status: "done",
      elapsedMs: Date.now() - startedAt,
      textChars: text.length,
      sqliteTotalChangesDelta: this.totalChanges() - before,
      diagnostics: this.diagnostics(),
    };
  }

  private appendEvent(eventType: string, payload: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO study_events (event_type, payload_json, created_at) VALUES (?, ?, ?)",
      eventType,
      JSON.stringify(payload),
      Date.now(),
    );
  }

  private totalChanges(): number {
    const [row] = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT total_changes() AS count")
      .toArray();
    return row?.count ?? 0;
  }
}

/** Directory cost is isolated in a second SQLite-backed namespace. */
export class PiBenchDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS training_meta (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
  }

  ensure(id: string) {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO training_meta (id, created_at, updated_at) VALUES (?, ?, ?)",
      id,
      now,
      now,
    );
  }

  touch(id: string) {
    this.ctx.storage.sql.exec(
      "UPDATE training_meta SET updated_at = ? WHERE id = ?",
      Date.now(),
      id,
    );
  }

  diagnostics() {
    const [rows] = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM training_meta")
      .toArray();
    const [changes] = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT total_changes() AS count")
      .toArray();
    return { rows: rows?.count ?? 0, sqliteTotalChanges: changes?.count ?? 0 };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, benchmark: "pi-1.5-remote" });
    }

    if (url.pathname === "/api/run" && request.method === "POST") {
      const training = url.searchParams.get("training")?.trim();
      if (!training || !/^[a-zA-Z0-9_-]{1,96}$/.test(training)) {
        return json({ error: "invalid training id" }, { status: 400 });
      }

      const body = (await request.json()) as { mode?: BenchMode };
      if (body.mode !== "history" && body.mode !== "tool") {
        return json({ error: "mode must be history or tool" }, { status: 400 });
      }

      const agent = env.PiBenchAgent.getByName("agent--" + training);
      const directory = env.PiBenchDirectory.getByName("dir--" + training);

      await directory.ensure(training);
      const result = await agent.run(body.mode);
      // Exactly one directory metadata update per completed turn.
      await directory.touch(training);

      return json({
        ...result,
        training,
        agentName: "agent--" + training,
        directoryName: "dir--" + training,
        directory: await directory.diagnostics(),
      });
    }

    if (url.pathname === "/api/diag" && request.method === "GET") {
      const training = url.searchParams.get("training")?.trim();
      if (!training) return json({ error: "training required" }, { status: 400 });
      const agent = env.PiBenchAgent.getByName("agent--" + training);
      const directory = env.PiBenchDirectory.getByName("dir--" + training);
      return json({
        agent: await agent.diagnostics(),
        directory: await directory.diagnostics(),
      });
    }

    return json({ error: "not found" }, { status: 404 });
  },
};
