const base = "https://medical-edu-pi-remote-bench.zhangjiahe0830.workers.dev";

async function run(mode, training, index) {
  const startedAt = new Date().toISOString();
  const response = await fetch(
    `${base}/api/run?training=${encodeURIComponent(training)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  const body = await response.json();
  const finishedAt = new Date().toISOString();
  const record = {
    mode,
    phase: index === 1 ? "cold" : "warm",
    index,
    training,
    startedAt,
    finishedAt,
    httpStatus: response.status,
    body,
  };
  console.log("PI_REMOTE_BENCH " + JSON.stringify(record));
  if (!response.ok || body?.status !== "done") {
    throw new Error("benchmark request failed: " + JSON.stringify(record));
  }
  return record;
}

const stamp = Date.now();
const plans = [
  { mode: "history", training: `remote-warm-history-${stamp}` },
  { mode: "tool", training: `remote-warm-tool-${stamp}` },
];

const results = [];
for (const plan of plans) {
  for (let index = 1; index <= 4; index += 1) {
    results.push(await run(plan.mode, plan.training, index));
  }
}

console.log(
  "PI_REMOTE_BENCH_SUMMARY " +
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      results: results.map((item) => ({
        mode: item.mode,
        phase: item.phase,
        index: item.index,
        training: item.training,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        elapsedMs: item.body.elapsedMs,
        textChars: item.body.textChars,
        sqliteTotalChangesDelta: item.body.sqliteTotalChangesDelta,
        directory: item.body.directory,
      })),
    }),
);
