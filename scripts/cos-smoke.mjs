#!/usr/bin/env node

/**
 * CareerOneStop live-API smoke check.
 *
 * Exercises every endpoint family in src/lib/career/careeronestop-counseling.ts
 * against the REAL CareerOneStop API with realistic, fixed inputs, so that the
 * day COS_USER_ID / COS_API_TOKEN land in an environment, one command proves
 * the whole client actually works before any student sees it. That client's
 * own header notes it has never been exercised against the live authenticated
 * API — this script is what closes that gap, on demand.
 *
 * Read-only in effect: every request either GETs data or (for the Skills
 * Matcher) POSTs a self-assessment that CareerOneStop does not persist
 * against a student record — this script writes nothing locally (no DB
 * calls) and nothing durable server-side. Safe to re-run at will.
 *
 * Exit codes:
 *   0 — configured and every endpoint family passed
 *   1 — configured but one or more families failed (see PASS/FAIL lines)
 *   2 — NOT configured (COS_USER_ID / COS_API_TOKEN absent) — kept distinct
 *       from a failing run so an operator or CI step can tell "nothing to
 *       test yet" apart from "the live API broke"
 *
 * Usage:
 *   npm run cos:smoke          (once wired — see scripts/cos-smoke.mjs header)
 *   npx tsx scripts/cos-smoke.mjs
 *
 * Never logs COS_USER_ID or COS_API_TOKEN — belt-and-suspenders redaction
 * below even though the client itself never returns or logs either value.
 *
 * KNOWN LIMITATION: FAIL details below are built from the typed
 * CounselingErrorCode the client already returns (unauthorized, not_found,
 * timeout, network, bad_response, http_error) plus whatever status code the
 * client's own structured logger happened to emit for that call. The client
 * deliberately discards the raw response body after JSON.parse and never
 * surfaces it to callers (see careeronestop-counseling.ts, cosRequest(),
 * ~line 142) — so a literal "first 200 chars of body" is not obtainable
 * without changing the client, which is out of scope for this script. If
 * deeper body-level diagnosis is ever needed, that's a follow-up to the
 * client itself (e.g. an opt-in debug capture), not this smoke script.
 */

import path from "node:path";
import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

// Fixed, realistic inputs shared across families for a coherent trace.
// 29-2061.00 is Licensed Practical/Vocational Nurse (LPN) — a common SPOKES
// pathway. WV matches the program's home state (SPOKES is West Virginia).
const SOC_CODE = "29-2061.00";
const OCCUPATION_KEYWORD = "licensed practical nurse";
const LOCATION = "WV";
const SKILLS_MATCHER_PARTIAL_COUNT = 5; // deliberately less than the full ~40-question set

/** @type {Array<{ name: string, ok: boolean, elapsedMs: number, detail: string | null }>} */
const results = [];

function redact(text) {
  const token = process.env.COS_API_TOKEN;
  const userId = process.env.COS_USER_ID;
  let out = String(text);
  if (token) out = out.split(token).join("[REDACTED_TOKEN]");
  if (userId) out = out.split(userId).join("[REDACTED_USER_ID]");
  return out;
}

function truncate(text, max = 200) {
  const value = redact(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Run one endpoint family through the real client function. Captures
 * console.error output emitted by the client's structured logger (see
 * src/lib/logger.ts — warn/error both write to console.error) so a failing
 * call's endpoint label + status + error code — everything the client is
 * willing to expose — shows up in the FAIL line.
 */
async function runFamily(name, fn, describe) {
  const capturedLines = [];
  const originalError = console.error;
  console.error = (...args) => {
    capturedLines.push(
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    );
  };

  const startedAt = Date.now();
  let outcome;
  try {
    const value = await fn();
    outcome = { threw: false, value };
  } catch (error) {
    outcome = { threw: true, error };
  } finally {
    console.error = originalError;
  }
  const elapsedMs = Date.now() - startedAt;

  if (outcome.threw) {
    const detail = truncate(
      outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    );
    results.push({ name, ok: false, elapsedMs, detail: `threw: ${detail}` });
    return null;
  }

  const value = outcome.value;
  if (value && value.error) {
    const logDetail =
      capturedLines.length > 0
        ? truncate(capturedLines.join(" | "))
        : "no additional detail logged by the client for this failure";
    results.push({ name, ok: false, elapsedMs, detail: `error=${value.error} — ${logDetail}` });
    return null;
  }

  const note = describe ? describe(value) : null;
  results.push({ name, ok: true, elapsedMs, detail: note });
  return value;
}

function printReport() {
  console.log("");
  console.log("CareerOneStop smoke check — endpoint family results");
  console.log("-----------------------------------------------------------------");
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.name} (${r.elapsedMs}ms)`);
    if (r.detail) {
      console.log(`       ${r.detail}`);
    }
  }
  console.log("-----------------------------------------------------------------");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} families passed`);
  return failed.length === 0;
}

async function main() {
  const { isCareerOneStopConfigured } = await import(
    "../src/lib/career/careeronestop-config.ts"
  );

  if (!isCareerOneStopConfigured()) {
    const envPath = path.resolve(process.cwd(), ".env.local");
    console.log(
      [
        "CareerOneStop is NOT configured — nothing to smoke-test yet.",
        "",
        "This check needs both COS_USER_ID and COS_API_TOKEN. Set them here:",
        "  - Render (production): the VisionQuest service → Environment tab →",
        "    add COS_USER_ID and COS_API_TOKEN",
        `  - Local dev: add these two lines to ${envPath}`,
        "        COS_USER_ID=",
        "        COS_API_TOKEN=",
        "    (create the file if it does not exist; it is gitignored — never",
        "    commit real values)",
        "",
        "Re-run this check once both are set:",
        "  npm run cos:smoke",
      ].join("\n"),
    );
    process.exit(2);
    return;
  }

  const {
    fetchSkillsMatcherQuestions,
    submitSkillsMatcher,
    searchOccupations,
    fetchOccupationProfile,
    fetchOccupationWages,
    fetchToolsAndTechnology,
    fetchTrainingPrograms,
  } = await import("../src/lib/career/careeronestop-counseling.ts");

  console.log(
    "CareerOneStop configured — exercising every endpoint family against the live API…",
  );

  const questionsResult = await runFamily(
    "skillsMatcher.questions (GET)",
    () => fetchSkillsMatcherQuestions(),
    (v) => `${v.questions.length} questions returned`,
  );

  if (questionsResult && questionsResult.questions.length > 0) {
    const partial = questionsResult.questions
      .slice(0, SKILLS_MATCHER_PARTIAL_COUNT)
      .map((q, index) => ({ elementId: q.elementId, rating: (index % 5) + 1 }));
    await runFamily(
      `skillsMatcher.submit (POST, PARTIAL — ${partial.length}/${questionsResult.questions.length} answers)`,
      () => submitSkillsMatcher(partial),
      (v) => `${v.matches.length} matched occupations returned`,
    );
  } else {
    results.push({
      name: "skillsMatcher.submit (POST, PARTIAL)",
      ok: false,
      elapsedMs: 0,
      detail: "skipped — prerequisite skillsMatcher.questions returned no questions to answer",
    });
  }

  await runFamily(
    `occupation.search ("${OCCUPATION_KEYWORD}")`,
    () => searchOccupations(OCCUPATION_KEYWORD, { limit: 5 }),
    (v) => `${v.occupations.length} occupations returned`,
  );

  await runFamily(
    `occupation.profile (${SOC_CODE}, ${LOCATION})`,
    () => fetchOccupationProfile(SOC_CODE, { location: LOCATION }),
    (v) => (v.profile ? `profile for "${v.profile.title}" returned` : "no profile returned"),
  );

  await runFamily(
    `comparesalaries.wage (${SOC_CODE}, ${LOCATION})`,
    () => fetchOccupationWages(SOC_CODE, { location: LOCATION }),
    (v) => `${v.wages.length} wage rows returned`,
  );

  await runFamily(
    `techtool.byOccupation (${SOC_CODE})`,
    () => fetchToolsAndTechnology(SOC_CODE),
    (v) => `${v.tools.length} tool categories, ${v.technology.length} technology categories`,
  );

  await runFamily(
    `training.programs ("${OCCUPATION_KEYWORD}", ${LOCATION})`,
    () => fetchTrainingPrograms(OCCUPATION_KEYWORD, { location: LOCATION, limit: 5 }),
    (v) => `${v.programs.length}/${v.totalCount} programs returned`,
  );

  const allPassed = printReport();
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(
    "cos-smoke: unexpected top-level failure:",
    redact(error instanceof Error ? (error.stack ?? error.message) : String(error)),
  );
  process.exit(1);
});
