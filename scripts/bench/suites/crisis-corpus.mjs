/**
 * Shared machinery for the two crisis-corpus benchmarks (crisis-en, crisis-es).
 *
 * WHAT IT MEASURES
 * ----------------
 * One number per bucket, all produced by running the SAME entry point the chat
 * route runs — `detectCrisisSignal` from src/lib/sage/crisis-detection.ts,
 * which `scanStudentMessageForCrisis` calls at the top of POST /api/chat/send
 * (src/lib/chat/crisis-scan.ts) and which `crisisResourceBlockFor` uses to
 * choose the 988 block. Nothing is reimplemented here: the corpus is the
 * product knowledge, the detector is the thing under test.
 *
 *   recall_must_detect      matched / labelled "detect"          (higher better)
 *   fp_rate_hard_negatives  matched / crisis-ADJACENT silent rows (lower better)
 *   fp_rate_neutral         matched / ordinary silent rows        (lower better)
 *
 * Per-family recall and the full miss list go into `details`, because the
 * headline recall number on its own cannot tell you WHICH kind of disclosure
 * is being missed — and on this detector that distinction is the whole point
 * (see the means-family gap named in the crisis-en suite header).
 *
 * PINNED CROSS-CHECK
 * ------------------
 * Rows tagged `source: "pinned-test"` are copies of what the unit suite pins
 * in src/lib/sage/crisis-fixtures.ts. `crossCheckPinned` proves the copy still
 * agrees — same text present, same expected label — so a corpus can never
 * certify the opposite of a test. It runs inside --self-test and inside
 * src/lib/benchmarks/crisis-corpus.test.ts, so a drift fails both the
 * benchmark and `npm test`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** Buckets a corpus row may sit in. */
export const BUCKETS = ["must_detect", "hard_negative", "neutral"];

/**
 * The production entry point, imported (never copied). Loaded lazily so that
 * importing this module for its pure helpers — which the node:test file does —
 * does not drag in the detector's Prisma-side dependencies.
 */
export async function loadDetector() {
  const mod = await import("@/lib/sage/crisis-detection");
  return mod.detectCrisisSignal;
}

/** Read and shape-check a corpus fixture. */
export function loadFixture(fixturePath) {
  const parsed = JSON.parse(readFileSync(fixturePath, "utf8"));
  assertFixtureShape(parsed, fixturePath);
  return parsed;
}

export function assertFixtureShape(fixture, label = "fixture") {
  if (!fixture || !Array.isArray(fixture.rows)) {
    throw new Error(`${label}: expected an object with a "rows" array`);
  }
  // Exact duplicates are always an error. A pair differing only in case is an
  // error only when both rows are authored: the unit fixtures deliberately pin
  // both "i wanna die" and "I wanna die" to assert case-insensitivity, and the
  // corpus has to be able to carry both.
  const seenExact = new Set();
  const seenLower = new Map();
  fixture.rows.forEach((row, index) => {
    const where = `${label} row ${index}`;
    if (typeof row.text !== "string") throw new Error(`${where}: text must be a string`);
    if (row.label !== "detect" && row.label !== "silent") {
      throw new Error(`${where}: label must be "detect" or "silent", got ${JSON.stringify(row.label)}`);
    }
    if (typeof row.family !== "string" || !row.family) {
      throw new Error(`${where}: family must be a non-empty string`);
    }
    if (!BUCKETS.includes(row.bucket)) {
      throw new Error(`${where}: bucket must be one of ${BUCKETS.join(", ")}, got ${JSON.stringify(row.bucket)}`);
    }
    if (row.source !== "pinned-test" && row.source !== "authored") {
      throw new Error(`${where}: source must be "pinned-test" or "authored"`);
    }
    if (row.label === "detect" && row.bucket !== "must_detect") {
      throw new Error(`${where}: a "detect" row must sit in the must_detect bucket`);
    }
    if (row.label === "silent" && row.bucket === "must_detect") {
      throw new Error(`${where}: a "silent" row cannot sit in the must_detect bucket`);
    }
    if (seenExact.has(row.text)) {
      throw new Error(`${where}: duplicate text ${JSON.stringify(row.text)}`);
    }
    seenExact.add(row.text);
    const lower = row.text.toLowerCase();
    const prior = seenLower.get(lower);
    if (prior && prior.source === "authored" && row.source === "authored") {
      throw new Error(`${where}: case-only duplicate of an earlier authored row ${JSON.stringify(row.text)}`);
    }
    if (!prior) seenLower.set(lower, row);
  });
  return fixture;
}

/**
 * Every pinned row in the corpus must still match what the unit suite pins.
 *
 * Direction matters and both are checked:
 *   - corpus -> tests: a `pinned-test` row whose text is not in any pinned
 *     array, or whose label disagrees with it, is a corpus that has drifted.
 *   - tests -> corpus: a pinned phrase that reached NEITHER corpus is a case
 *     the benchmark silently stopped covering.
 *
 * `otherLanguageRows` lets the English check account for the Spanish rows that
 * live in the English test file (they are homed in crisis-es), and vice versa.
 */
export function crossCheckPinned({ fixture, pinned, otherLanguageTexts = [] }) {
  const expected = new Map();
  for (const { text, category } of pinned.EN_SHOULD_MATCH) expected.set(text, { label: "detect", category });
  for (const text of pinned.EN_SHOULD_NOT_MATCH) expected.set(text, { label: "silent" });
  for (const { text, category } of pinned.ES_SHOULD_MATCH) expected.set(text, { label: "detect", category });
  for (const text of pinned.ES_SHOULD_NOT_MATCH) expected.set(text, { label: "silent" });
  for (const [text] of pinned.INFORMAL_MUST_DETECT) expected.set(text, { label: "detect" });
  for (const [text] of pinned.INFORMAL_MUST_NOT_DETECT) expected.set(text, { label: "silent" });

  const problems = [];
  const covered = new Set();

  for (const row of fixture.rows) {
    if (row.source !== "pinned-test") continue;
    const want = expected.get(row.text);
    if (!want) {
      problems.push(
        `row is tagged source:"pinned-test" but its exact text is in no pinned array: ${JSON.stringify(row.text)}`,
      );
      continue;
    }
    covered.add(row.text);
    if (want.label !== row.label) {
      problems.push(
        `pinned row ${JSON.stringify(row.text)} is labelled "${row.label}" in the corpus but "${want.label}" in the unit fixtures`,
      );
    }
    if (want.category && row.category && want.category !== row.category) {
      problems.push(
        `pinned row ${JSON.stringify(row.text)} carries category "${row.category}" but the unit fixtures pin "${want.category}"`,
      );
    }
  }

  const elsewhere = new Set(otherLanguageTexts);
  for (const text of expected.keys()) {
    if (covered.has(text) || elsewhere.has(text)) continue;
    problems.push(`pinned phrase is in no corpus row: ${JSON.stringify(text)}`);
  }

  return problems;
}

function ratio(hits, total) {
  return total === 0 ? 0 : hits / total;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Score one corpus. Returns metrics in the runner's shape.
 *
 * `maxMissesListed` bounds what lands in the result file — a full miss list on
 * a 600-row corpus would dominate the JSON, and the count is what the
 * dashboard plots. Per-family numbers are never truncated: they are the part a
 * human reads to decide what to build next.
 */
export async function scoreCorpus(fixture, { maxMissesListed = 40 } = {}) {
  const detect = await loadDetector();

  const byBucket = { must_detect: [], hard_negative: [], neutral: [] };
  for (const row of fixture.rows) byBucket[row.bucket].push(row);

  const familyStats = new Map();
  function bump(family, key) {
    const stat = familyStats.get(family) ?? { n: 0, matched: 0 };
    stat.n += 1;
    if (key) stat.matched += 1;
    familyStats.set(family, stat);
  }

  const misses = [];
  let detected = 0;
  for (const row of byBucket.must_detect) {
    const matched = detect(row.text).matched;
    if (matched) detected += 1;
    else misses.push({ text: row.text, family: row.family, source: row.source });
    bump(row.family, matched);
  }

  const falsePositives = { hard_negative: [], neutral: [] };
  const fpFamilyStats = new Map();
  for (const bucket of ["hard_negative", "neutral"]) {
    for (const row of byBucket[bucket]) {
      const result = detect(row.text);
      const stat = fpFamilyStats.get(row.family) ?? { n: 0, fired: 0 };
      stat.n += 1;
      if (result.matched) {
        stat.fired += 1;
        falsePositives[bucket].push({
          text: row.text,
          family: row.family,
          source: row.source,
          category: result.category,
          lang: result.lang,
        });
      }
      fpFamilyStats.set(row.family, stat);
    }
  }

  const recallByFamily = {};
  for (const [family, stat] of [...familyStats.entries()].sort()) {
    recallByFamily[family] = { n: stat.n, detected: stat.matched, recall: round(ratio(stat.matched, stat.n)) };
  }
  const fpByFamily = {};
  for (const [family, stat] of [...fpFamilyStats.entries()].sort()) {
    fpByFamily[family] = { n: stat.n, fired: stat.fired, fpRate: round(ratio(stat.fired, stat.n)) };
  }

  return {
    metrics: [
      {
        id: "recall_must_detect",
        value: round(ratio(detected, byBucket.must_detect.length)),
        n: byBucket.must_detect.length,
        details: {
          detected,
          missed: misses.length,
          recallByFamily,
          missedSample: misses.slice(0, maxMissesListed).map((m) => `${m.family}: ${m.text}`),
          missedSampleTruncated: misses.length > maxMissesListed,
        },
      },
      {
        id: "fp_rate_hard_negatives",
        value: round(ratio(falsePositives.hard_negative.length, byBucket.hard_negative.length)),
        n: byBucket.hard_negative.length,
        details: {
          fired: falsePositives.hard_negative.length,
          fpByFamily,
          firedSample: falsePositives.hard_negative
            .slice(0, maxMissesListed)
            .map((f) => `${f.family} [${f.category}/${f.lang}]: ${f.text}`),
          firedSampleTruncated: falsePositives.hard_negative.length > maxMissesListed,
        },
      },
      {
        id: "fp_rate_neutral",
        value: round(ratio(falsePositives.neutral.length, byBucket.neutral.length)),
        n: byBucket.neutral.length,
        details: {
          fired: falsePositives.neutral.length,
          firedSample: falsePositives.neutral
            .slice(0, maxMissesListed)
            .map((f) => `${f.family} [${f.category}/${f.lang}]: ${f.text}`),
        },
      },
    ],
  };
}

/**
 * Shared `--self-test` body. Loads the suite's own config so the fixture path
 * is never restated in two places, runs the scorer, runs the pinned
 * cross-check, and prints the metrics. Exits 1 on any problem.
 */
export async function selfTest({ suite, otherFixture }) {
  const configPath = path.join(REPO_ROOT, "config", "benchmarks", `${suite}.json`);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const fixturePath = path.join(REPO_ROOT, config.fixture);
  const fixture = loadFixture(fixturePath);

  const pinned = await import("@/lib/sage/crisis-fixtures");
  const otherTexts = otherFixture
    ? loadFixture(path.join(REPO_ROOT, otherFixture)).rows.map((r) => r.text)
    : [];
  const problems = crossCheckPinned({ fixture, pinned, otherLanguageTexts: otherTexts });
  if (problems.length > 0) {
    console.error(`${suite}: pinned cross-check FAILED`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  const counts = { must_detect: 0, hard_negative: 0, neutral: 0 };
  for (const row of fixture.rows) counts[row.bucket] += 1;

  const { metrics } = await scoreCorpus(fixture);
  console.log(`${suite} (tier ${config.tier}) — ${fixture.rows.length} rows`);
  console.log(
    `  corpus: must_detect ${counts.must_detect}, hard_negative ${counts.hard_negative}, neutral ${counts.neutral}`,
  );
  console.log(`  pinned cross-check: OK`);
  for (const metric of metrics) {
    const floor = (config.metrics ?? []).find((m) => m.id === metric.id)?.floor;
    const floorText = floor === undefined ? "" : ` (floor ${floor})`;
    console.log(`  ${metric.id}: ${metric.value} over n=${metric.n}${floorText}`);
  }
  const recall = metrics.find((m) => m.id === "recall_must_detect");
  console.log("  recall by family:");
  for (const [family, stat] of Object.entries(recall.details.recallByFamily)) {
    console.log(`    ${family.padEnd(20)} ${stat.detected}/${stat.n} = ${stat.recall}`);
  }
  const fp = metrics.find((m) => m.id === "fp_rate_hard_negatives");
  const firing = Object.entries(fp.details.fpByFamily).filter(([, s]) => s.fired > 0);
  if (firing.length > 0) {
    console.log("  false positives by family:");
    for (const [family, stat] of firing) {
      console.log(`    ${family.padEnd(20)} ${stat.fired}/${stat.n} = ${stat.fpRate}`);
    }
    for (const line of fp.details.firedSample) console.log(`      ${line}`);
  }
  const neutral = metrics.find((m) => m.id === "fp_rate_neutral");
  for (const line of neutral.details.firedSample) console.log(`    NEUTRAL FP ${line}`);
}
