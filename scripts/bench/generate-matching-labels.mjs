#!/usr/bin/env node
// =============================================================================
// Generate `config/benchmarks/fixtures/matching-labels.json`.
//
// Every student x lead pair in the synthetic cohort, labelled `fit`, `stretch`
// or `block`. 50 x 40 = 2,000 labels.
//
// THE POINT OF THIS FILE IS THAT IT DOES NOT USE `fit()`.
//
// Labelling the corpus by running the ranker would make precision@3 a
// tautology — the benchmark would report 1.0 forever and would keep reporting
// 1.0 after somebody broke the ranking, because the labels would break with it.
// So the rule below is an INDEPENDENT judgement, written in the terms an
// instructor uses when they look at a student and a job order:
//
//   BLOCK   — a fact makes this impossible today. Not "a bad idea": impossible.
//   FIT     — the four things an instructor checks all line up: it is the kind
//             of work they said they wanted, they can work the hours, it pays
//             at least what they said they need, and they already hold whatever
//             card it asks for.
//   STRETCH — anything else that is not blocked. Worth showing, worth a
//             conversation, not an obvious yes.
//
// Those four checks deliberately do NOT include the axes the ranker weights
// most heavily on its own (location proximity, RIASEC overlap, résumé-skill
// overlap, source trust, "has hired a grad before"). That is what makes the
// benchmark informative: the ranker can score highly on axes the label rule
// never looks at, and precision@3 measures whether doing so still puts the
// instructor-obvious jobs on top.
//
// OWNER STEP (design §9 decision 2, plan owner-default 2): these are one
// build agent's labels. Britt's chosen default is that ONE SPOKES INSTRUCTOR
// AUDITS 200 PAIRS before the floor is treated as authoritative. The written
// rule above is what they are auditing — if they disagree with the rule, the
// rule changes here and the whole file is regenerated, rather than individual
// labels being hand-edited into disagreement with it.
//
//   node scripts/bench/generate-matching-labels.mjs [--check]
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCohort, visibleLeadsFor } from "./lib/cohort.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  HERE,
  "..",
  "..",
  "config",
  "benchmarks",
  "fixtures",
  "matching-labels.json",
);

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAYS = DAYS.slice(0, 5);
const WEEKEND = DAYS.slice(5);
const SLOTS = ["morning", "afternoon", "evening", "overnight"];

/**
 * Which grid cells each shift covers — the same partition of the 28-cell week
 * the product uses, restated here because this file may not read the product's
 * matcher. `synthetic-cohort.test.ts` pins the two against each other, so a
 * change to the shift vocabulary fails a test instead of silently making every
 * label wrong.
 */
const SHIFT_CELLS = {
  day: WEEKDAYS.flatMap((day) => [`${day}/morning`, `${day}/afternoon`]),
  evening: WEEKDAYS.map((day) => `${day}/evening`),
  night: WEEKDAYS.map((day) => `${day}/overnight`),
  weekend: WEEKEND.flatMap((day) => SLOTS.map((slot) => `${day}/${slot}`)),
};

/** Hours per week each pay period represents, for the pay-floor comparison. */
const PERIOD_HOURS = { hour: 1, day: 8, week: 40, month: 173.33, year: 2080 };

/** A student will walk this far and no further. */
const MAX_WALKING_MILES = 2;

function hasAnyAvailability(grid) {
  return DAYS.some((day) => SLOTS.some((slot) => grid[day]?.[slot]));
}

function coveredShare(profile, cells) {
  const covered = cells.filter((cell) => {
    const [day, slot] = cell.split("/");
    return Boolean(profile.availability[day]?.[slot]);
  }).length;
  return covered / cells.length;
}

/**
 * The share of EVERYTHING the lead named that this student can cover, or null
 * when there is nothing to compare — no shift named, or no availability
 * declared.
 *
 * `null` and `0` must stay distinct. Missing data is never a block; a declared
 * mismatch — nothing at all in common — is.
 */
function shiftCoverage(profile, lead) {
  const shifts = [...new Set(lead.schedule.shifts ?? [])];
  if (shifts.length === 0) return null;
  if (!profile || !hasAnyAvailability(profile.availability)) return null;

  const cells = shifts.flatMap((shift) => SHIFT_CELLS[shift] ?? []);
  if (cells.length === 0) return null;
  return coveredShare(profile, cells);
}

/**
 * Can they actually work one of the shifts this job offers?
 *
 * The instructor's question is "can you do evenings?", not "can you cover
 * every hour this employer ever staffs". A lead naming day, evening, night and
 * weekend is offering four schedules to choose between, so a student free on
 * weekday evenings can work it — and measuring them against all 28 cells would
 * score that 0.18 and call an obvious match a stretch.
 *
 * So: at least three quarters of at least ONE named shift, which tolerates a
 * student who is unavailable one weekday without admitting somebody who can
 * only ever make Tuesday.
 */
function coversANamedShift(profile, lead) {
  const shifts = [...new Set(lead.schedule.shifts ?? [])];
  if (shifts.length === 0) return true; // nothing was asked
  if (!profile || !hasAnyAvailability(profile.availability)) return true; // nothing was answered
  return shifts.some((shift) => {
    const cells = SHIFT_CELLS[shift] ?? [];
    return cells.length > 0 && coveredShare(profile, cells) >= 0.75;
  });
}

/** The best hourly rate the lead states, or null when it states none. */
function bestHourly(lead) {
  const hours = PERIOD_HOURS[lead.payPeriod] ?? 1;
  const best = lead.payMax ?? lead.payMin;
  if (best === null || best === undefined) return null;
  return best / hours;
}

/** Can this student get to this job? "unknown" is a real answer, never "no". */
function canGetThere(profile, lead) {
  const hasRoute = Boolean(lead.transitNotes && lead.transitNotes.trim());
  const transport = profile?.transport ?? null;
  if (!transport) return "unknown";
  if (transport === "car" || transport === "ride") return "yes";
  if (transport === "bus") return hasRoute ? "yes" : "unknown";
  if (transport === "walk") {
    if (hasRoute) return "yes";
    if (lead.distanceMiles === null || lead.distanceMiles === undefined) return "unknown";
    return lead.distanceMiles <= MAX_WALKING_MILES ? "yes" : "no";
  }
  return hasRoute ? "yes" : "no"; // transport === "none"
}

/**
 * Label one pair, and say WHY in the same breath.
 *
 * The reason string is not decoration: it is what an auditing instructor reads
 * to decide whether they agree, and what a failing benchmark prints so a human
 * can see which judgement the ranker disagreed with.
 */
function labelPair(student, profile, lead, options) {
  const blocks = [];

  if (lead.status !== "open") blocks.push("the job is not open");
  if (lead.employerStatus === "do_not_contact") blocks.push("do not contact this employer");
  if ((options.withdrawnEmployerIds ?? []).includes(lead.employerId)) {
    blocks.push("they backed out of this employer before");
  }

  const coverage = shiftCoverage(profile, lead);
  if (coverage === 0) blocks.push("they cannot work any of these hours");

  const missingCerts = (lead.requirements.mustHaveCerts ?? []).filter(
    (certId) => !student.verifiedCertIds.includes(certId),
  );
  if (missingCerts.length > 0) blocks.push(`they do not hold the ${missingCerts[0]} card`);

  const floor = profile?.payFloorHourly ?? null;
  const hourly = bestHourly(lead);
  if (floor !== null && hourly !== null && hourly < floor) {
    blocks.push("the top of the pay range is under the floor they set");
  }

  if (canGetThere(profile, lead) === "no") blocks.push("they have no way to get there");

  if (blocks.length > 0) {
    return { label: "block", reason: blocks.join("; ") };
  }

  // FIT — the four checks an instructor makes, all satisfied.
  const wantsThisWork = lead.clusters.some((cluster) => student.topClusters.includes(cluster));
  const worksTheHours = coversANamedShift(profile, lead);
  // Unknown pay is not insufficient pay, on this side of the rule exactly as on
  // the block side: a posting that states no rate is a question for the
  // instructor, not a reason to call an otherwise-obvious match a stretch.
  const payIsEnough = floor === null || hourly === null || hourly >= floor;
  const asksNothingTheyLack =
    (lead.requirements.mustHaveCerts ?? []).length === 0 ||
    (lead.requirements.mustHaveCerts ?? []).every((certId) =>
      student.verifiedCertIds.includes(certId),
    );

  if (wantsThisWork && worksTheHours && payIsEnough && asksNothingTheyLack) {
    return {
      label: "fit",
      reason: "the kind of work they picked, hours they can cover, pay above their floor",
    };
  }

  const why = [];
  if (!wantsThisWork) why.push("not the kind of work they picked");
  if (!worksTheHours) why.push("cannot cover any one of the shifts it offers");
  if (!payIsEnough) why.push("pay is not clearly above their floor");
  if (!asksNothingTheyLack) why.push("asks for a card they do not hold");
  return { label: "stretch", reason: why.join("; ") || "nothing rules it out, nothing stands out" };
}

function build() {
  const cohort = loadCohort();
  const pairs = [];

  for (const student of cohort.students) {
    const profile = cohort.workProfileByStudentId.get(student.id) ?? null;
    for (const lead of cohort.leads) {
      const { label, reason } = labelPair(student, profile, lead, {});
      pairs.push({ studentId: student.id, leadId: lead.id, label, reason });
    }
  }

  // The property the cohort generator cannot check for itself: precision@3
  // needs three slots to fill, so every student must have at least three
  // VISIBLE, unblocked leads and at least one `fit` among them. Without this,
  // a student contributes a denominator of 1 or 2 and the metric quietly stops
  // meaning "the top three are right".
  const byPair = new Map(pairs.map((pair) => [`${pair.studentId}/${pair.leadId}`, pair]));
  const thin = [];
  for (const student of cohort.students) {
    const visible = visibleLeadsFor(cohort, student);
    const usable = visible.filter(
      (lead) => byPair.get(`${student.id}/${lead.id}`).label !== "block",
    );
    const fits = usable.filter(
      (lead) => byPair.get(`${student.id}/${lead.id}`).label === "fit",
    );
    if (usable.length < 3 || fits.length < 1) {
      thin.push(`${student.id}: ${usable.length} unblocked, ${fits.length} fit`);
    }
  }
  if (thin.length > 0) {
    throw new Error(
      "These students cannot support precision@3 — regenerate the cohort so they can:\n  - " +
        thin.join("\n  - "),
    );
  }

  const counts = { fit: 0, stretch: 0, block: 0 };
  for (const pair of pairs) counts[pair.label] += 1;

  return {
    version: 1,
    cohort: "config/benchmarks/synthetic-cohort",
    labelledBy: "build agent (A3), 2026-09-05",
    ownerStep:
      "One SPOKES instructor audits 200 of these pairs (design §9 decision 2). They are " +
      "auditing the RULE stated in scripts/bench/generate-matching-labels.mjs, not the rows: " +
      "a disagreement changes the rule and regenerates the file, so the labels can never " +
      "drift out of step with the judgement they claim to encode.",
    rule: {
      block:
        "A fact makes it impossible: the job is closed, the employer is do-not-contact, the " +
        "student backed out of them before, they can work none of the named hours, they lack a " +
        "must-have card, the top of the pay range is under their stated floor, or they have no " +
        "way to get there.",
      fit:
        "Not blocked, AND it is one of the clusters they picked, AND they can cover at least " +
        "three quarters of at least ONE of the shifts it offers (or no shift was named, or " +
        "they declared no availability), AND the pay clears their floor (or they set none, or " +
        "the posting states none), AND they hold every card it requires (or it requires none).",
      stretch: "Anything else that is not blocked.",
    },
    notScored:
      "The rule deliberately ignores location proximity, RIASEC overlap, résumé-skill overlap, " +
      "source trust and the hired-a-grad-before bonus — the axes the ranker weights on its own. " +
      "Sharing them would make precision@3 a restatement of the score instead of a check on it.",
    counts,
    pairs,
  };
}

function main() {
  const check = process.argv.includes("--check");
  const next = `${JSON.stringify(build(), null, 2)}\n`;

  let current = null;
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    current = null;
  }

  if (current === next) {
    console.log("matching-labels.json is up to date.");
    return;
  }
  if (check) {
    console.error("matching-labels.json differs from the generator. Regenerate and commit it.");
    process.exit(1);
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, next);
  const parsed = JSON.parse(next);
  console.log(
    `wrote ${parsed.pairs.length} labels — ` +
      `${parsed.counts.fit} fit, ${parsed.counts.stretch} stretch, ${parsed.counts.block} block.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
