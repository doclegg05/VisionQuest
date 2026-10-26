/**
 * crisis-latency — how long POST /api/chat/send takes to commit to the staff
 * alert when the AI is down.
 *
 * This is the numeric guard on VQ-R-001. The bug that findings F4/#185 fixed
 * was not a slow detector; it was a route that reached its 503, its 429 and
 * its stream-error exits without ever calling the detector, so a student in
 * crisis got no alert precisely when the model was unavailable. The fix
 * hoisted `scanStudentMessageForCrisis` above provider resolution and the rate
 * limiters. This suite measures that the hoist is still there and still cheap:
 * 20 crisis messages replayed through the real route handler under three
 * failure modes, timed from request start to the moment
 * `recordWellbeingConcern` is entered.
 *
 * Two things are asserted by the metrics, not just one:
 *   p95_ms                 how fast the alert path is reached (floor 500 ms)
 *   concern_recorded_rate  whether it is reached AT ALL on every failure exit
 *
 * The second is the one that would have caught VQ-R-001: a route that stopped
 * scanning would score a perfect latency on the samples it still recorded, and
 * the rate metric is what turns that into a visible zero.
 *
 * MEASURED at the commit that introduced this suite: p95 0.6 ms over 20
 * samples, concern_recorded_rate 1.0. The floor is three orders of magnitude
 * above the measurement on purpose — it is a "somebody put a database call in
 * front of the scan" tripwire, not a tuning target.
 *
 * The messages come from the crisis-en corpus (must-detect rows the detector
 * actually matches), so this suite and crisis-en cannot drift apart about what
 * a crisis message is.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadFixture, REPO_ROOT } from "./crisis-corpus.mjs";

const SAMPLE_COUNT = 20;
const HARNESS = path.join(REPO_ROOT, "scripts", "bench", "harness", "crisis-latency.ts");

/**
 * The 20 messages. Chosen deterministically (first N matching rows in corpus
 * order) so two runs on the same commit replay the same messages — a latency
 * number measured on a different sample each time is not comparable.
 */
async function pickMessages() {
  const { detectCrisisSignal } = await import("@/lib/sage/crisis-detection");
  const fixture = loadFixture(path.join(REPO_ROOT, "config/benchmarks/fixtures/crisis-en.json"));
  const picked = [];
  for (const row of fixture.rows) {
    if (row.bucket !== "must_detect") continue;
    if (!detectCrisisSignal(row.text).matched) continue;
    picked.push(row.text);
    if (picked.length === SAMPLE_COUNT) break;
  }
  if (picked.length < SAMPLE_COUNT) {
    throw new Error(`crisis-latency: only ${picked.length} usable crisis messages in the corpus`);
  }
  return picked;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export async function run() {
  const messages = await pickMessages();
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", HARNESS],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, BENCH_CRISIS_MESSAGES: JSON.stringify(messages) },
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `crisis-latency harness exited ${result.status}\n${result.stderr || result.stdout}`,
    );
  }

  const lastLine = result.stdout.trim().split("\n").filter(Boolean).pop();
  let payload;
  try {
    payload = JSON.parse(lastLine ?? "");
  } catch {
    throw new Error(`crisis-latency harness produced unparseable stdout:\n${result.stdout}`);
  }

  const samples = payload.samples ?? [];
  const recorded = samples.filter((s) => s.recorded);
  const durations = recorded.map((s) => s.ms).sort((a, b) => a - b);

  const byMode = {};
  for (const sample of samples) {
    const stat = byMode[sample.mode] ?? { n: 0, recorded: 0, maxMs: 0, statuses: {} };
    stat.n += 1;
    if (sample.recorded) {
      stat.recorded += 1;
      stat.maxMs = Math.max(stat.maxMs, round(sample.ms));
    }
    stat.statuses[String(sample.status)] = (stat.statuses[String(sample.status)] ?? 0) + 1;
    byMode[sample.mode] = stat;
  }

  return {
    metrics: [
      {
        id: "p95_ms",
        value: round(percentile(durations, 95)),
        n: recorded.length,
        details: {
          medianMs: round(percentile(durations, 50)),
          maxMs: round(durations[durations.length - 1] ?? 0),
          byMode,
          notRecorded: samples.filter((s) => !s.recorded).map((s) => s.mode),
        },
      },
      {
        id: "concern_recorded_rate",
        value: samples.length === 0 ? 0 : recorded.length / samples.length,
        n: samples.length,
        details: {
          recorded: recorded.length,
          modes: Object.keys(byMode),
        },
      },
    ],
  };
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  if (process.argv.includes("--self-test")) {
    const config = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "config", "benchmarks", "crisis-latency.json"), "utf8"),
    );
    const { metrics } = await run();
    console.log(`crisis-latency (tier ${config.tier})`);
    for (const metric of metrics) {
      const floor = config.metrics.find((m) => m.id === metric.id)?.floor;
      console.log(
        `  ${metric.id}: ${metric.value} over n=${metric.n}${floor === undefined ? "" : ` (floor ${floor})`}`,
      );
    }
    const p95 = metrics.find((m) => m.id === "p95_ms");
    console.log(`  median ${p95.details.medianMs} ms, max ${p95.details.maxMs} ms`);
    for (const [mode, stat] of Object.entries(p95.details.byMode)) {
      console.log(
        `    ${mode.padEnd(13)} recorded ${stat.recorded}/${stat.n}, max ${stat.maxMs} ms, statuses ${JSON.stringify(stat.statuses)}`,
      );
    }
    if (p95.details.notRecorded.length > 0) {
      console.error(`  MISSED the alert path on: ${p95.details.notRecorded.join(", ")}`);
      process.exitCode = 1;
    }
  } else {
    console.error("usage: node --import tsx scripts/bench/suites/crisis-latency.mjs --self-test");
    process.exitCode = 2;
  }
}
