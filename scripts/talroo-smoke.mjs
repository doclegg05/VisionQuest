#!/usr/bin/env node

/**
 * Talroo Search API smoke check.
 *
 * The Talroo adapter (src/lib/job-board/adapters/talroo.ts) was built from a
 * best-guess reading of Talroo's publisher docs, unverified against the live
 * API (see that file's header comment). This script is what closes that gap
 * on demand, the moment TALROO_API_KEY is issued — one command proves
 * fetchJobs() actually reaches Talroo and returns something shaped like a
 * NormalizedJob array before any student sees it.
 *
 * Modeled on scripts/cos-smoke.mjs's PASS/FAIL/redaction conventions, scaled
 * down to this adapter's single entry point.
 *
 * Read-only in effect: fetchJobs() only GETs; this script writes nothing
 * locally (no DB calls) and nothing durable server-side. Safe to re-run.
 *
 * Exit codes:
 *   0 — configured and fetchJobs completed with no logged request failures
 *   1 — configured but the API request failed (Job source request
 *       failed/errored was logged) or the call threw
 *   2 — NOT configured (TALROO_API_KEY absent) — kept distinct from a
 *       failing run so an operator or CI step can tell "nothing to test
 *       yet" apart from "the live API broke"
 *
 * Usage:
 *   npm run talroo:smoke
 *   npx tsx scripts/talroo-smoke.mjs
 *
 * Never logs TALROO_API_KEY — belt-and-suspenders redaction below even
 * though the adapter itself never logs it (the key lives only in the
 * Authorization header, and adapters/shared.ts's fetchJson only ever logs a
 * URL + status/error, never headers).
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

// Fixed, realistic input — matches cos-smoke.mjs's WV-focused convention.
const REGION = "Charleston, WV";
const RADIUS_MILES = 25;

function redact(text) {
  const key = process.env.TALROO_API_KEY;
  let out = String(text);
  if (key) out = out.split(key).join("[REDACTED_TALROO_KEY]");
  return out;
}

function truncate(text, max = 300) {
  const value = redact(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function main() {
  if (!process.env.TALROO_API_KEY) {
    console.log(
      [
        "Talroo is NOT configured — nothing to smoke-test yet.",
        "",
        "This check needs TALROO_API_KEY (Talroo publisher program,",
        "talroo.com/publish). Set it here:",
        "  - Render (production): the VisionQuest service → Environment tab →",
        "    add TALROO_API_KEY",
        "  - Local dev: add this line to .env.local",
        "        TALROO_API_KEY=",
        "    (create the file if it does not exist; it is gitignored — never",
        "    commit real values)",
        "",
        "Re-run this check once it's set:",
        "  npm run talroo:smoke",
      ].join("\n"),
    );
    process.exit(2);
    return;
  }

  const { talrooAdapter } = await import("../src/lib/job-board/adapters/talroo.ts");

  console.log(
    `Talroo configured — fetching jobs for "${REGION}" within ${RADIUS_MILES} miles…`,
  );

  // Capture the adapter's own failure logs (adapters/shared.ts's fetchJson
  // logs via logger.warn on a non-2xx response or a thrown error; logger.ts
  // routes both warn and error through console.error). fetchJobs() itself
  // never throws — a request failure yields fewer (or zero) mapped jobs
  // rather than an exception — so this is the only way to tell "the API
  // failed" apart from "no keyword matched anything this time".
  const capturedLines = [];
  const originalError = console.error;
  console.error = (...args) => {
    capturedLines.push(
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    );
  };

  const startedAt = Date.now();
  let jobs;
  try {
    jobs = await talrooAdapter.fetchJobs(REGION, RADIUS_MILES);
  } finally {
    console.error = originalError;
  }
  const elapsedMs = Date.now() - startedAt;

  console.log("");
  console.log("Talroo smoke check — result");
  console.log("-----------------------------------------------------------------");

  if (capturedLines.length > 0) {
    console.log(`[FAIL] talroo.fetchJobs (${elapsedMs}ms)`);
    console.log(`       ${truncate(capturedLines.join(" | "))}`);
    console.log("-----------------------------------------------------------------");
    console.log(
      "One or more requests failed. Check the assumed request/response shape",
      "in talroo.ts's header comment against Talroo's real docs and fix",
      "mapTalrooJob() (and the query-param names above it) accordingly.",
    );
    process.exit(1);
    return;
  }

  console.log(`[PASS] talroo.fetchJobs (${elapsedMs}ms)`);
  console.log(`       ${jobs.length} jobs returned`);
  if (jobs.length > 0) {
    const sample = jobs[0];
    console.log(`       sample: "${sample.title}" at ${sample.company} (${sample.location})`);
    console.log(`       sample salary: ${sample.salary ?? "not stated"}`);
    console.log(`       tracking url kept verbatim: ${truncate(sample.url, 120)}`);
  } else {
    console.log(
      "       0 jobs returned with no logged failure — plausible if none of",
      "       the SPOKES query keywords matched, but also consistent with the",
      "       assumed response shape (jobs: [...]) being wrong. Worth a manual",
      "       check against Talroo's real response before trusting this PASS.",
    );
  }
  console.log("-----------------------------------------------------------------");
  process.exit(0);
}

main().catch((error) => {
  console.error(
    "talroo-smoke: unexpected top-level failure:",
    redact(error instanceof Error ? (error.stack ?? error.message) : String(error)),
  );
  process.exit(1);
});
