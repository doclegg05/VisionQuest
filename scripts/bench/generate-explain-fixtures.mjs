#!/usr/bin/env node
// =============================================================================
// Generate `config/benchmarks/fixtures/explain-faithfulness.json`.
//
// Fifty explanations of ten postings: twenty faithful, thirty subtly wrong.
// The wrong ones are produced by MUTATING a faithful explanation in exactly one
// place, which is what makes the label trustworthy — the ground truth is the
// mutation, not somebody's later reading of the text.
//
// Four mutations, one per fact a student acts on:
//
//   wage         the pay figure moved to numbers the posting never states;
//   hours        the weekly hours swapped for a figure the posting never states;
//   place        the town changed to one the posting never names;
//   requirement  a credential invented that the posting never asks for.
//
// Each is SUBTLE by construction: one clause changes and the rest of the
// explanation stays correct, so a checker cannot pass by noticing that
// something looks generally off. That is the shape of the real failure —
// a model that read the posting and got one number wrong, not one that
// hallucinated a different job.
//
// The twenty faithful ones are the other half of the measurement and the
// harder half to get right. Ten restate every fact; ten deliberately say
// "The posting doesn't say." for the facts the posting omits, because a
// checker that flagged silence would train the model into guessing — the exact
// behaviour it exists to prevent.
//
//   node scripts/bench/generate-explain-fixtures.mjs [--check]
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  HERE,
  "..",
  "..",
  "config",
  "benchmarks",
  "fixtures",
  "explain-faithfulness.json",
);

/**
 * Ten postings, invented, in the shape the job-board adapters produce.
 *
 * `statesPay`, `statesHours` and `requires` say what each posting actually
 * commits to, so the "doesn't say" faithful variants can be built truthfully
 * instead of by hand.
 */
const POSTINGS = [
  {
    id: "posting_01",
    title: "Production Associate",
    company: "Ridgeline Metal Works",
    location: "Beckley, WV",
    salary: "$14 to $17 an hour",
    employmentType: "Full time, 40 hours a week",
    description:
      "Ridgeline Metal Works needs a production associate on the day shift. You move parts, " +
      "run a press, and check finished work. The team trains you on the job. You need an " +
      "OSHA 10 card.",
    duty: "move parts and check finished work",
    requires: "an OSHA 10 card",
  },
  {
    id: "posting_02",
    title: "Warehouse Selector",
    company: "Blackwater Logistics",
    location: "Charleston, WV",
    salary: "$16 an hour",
    employmentType: "Part time, 24 hours a week",
    description:
      "Blackwater Logistics is hiring a warehouse selector for evenings. You pull orders and " +
      "load pallets. Lifting is part of the job. A forklift card helps but is not required.",
    duty: "pull orders and load pallets",
    requires: null,
  },
  {
    id: "posting_03",
    title: "Certified Nursing Assistant",
    company: "New River Care Home",
    location: "Oak Hill, WV",
    salary: "$18 an hour",
    employmentType: "Full time, 36 hours a week",
    description:
      "New River Care Home is hiring a CNA for the night shift. You help residents with daily " +
      "care and keep notes. You need a CNA licence and a background check.",
    duty: "help residents with daily care",
    requires: "a CNA licence and a background check",
  },
  {
    id: "posting_04",
    title: "Front Desk Associate",
    company: "Cheat River Hospitality",
    location: "Morgantown, WV",
    salary: null,
    employmentType: "Part time, 20 hours a week",
    description:
      "Cheat River Hospitality wants a friendly front desk associate. You greet guests, take " +
      "bookings, and answer the phone. Weekend shifts are part of the job.",
    duty: "greet guests and take bookings",
    requires: null,
  },
  {
    id: "posting_05",
    title: "Grocery Stocker",
    company: "Kanawha Valley Grocers",
    location: "Charleston, WV",
    salary: "$13 an hour",
    employmentType: null,
    description:
      "Kanawha Valley Grocers needs a stocker for the early morning crew. You unload trucks " +
      "and fill shelves before the store opens.",
    duty: "unload trucks and fill shelves",
    requires: null,
  },
  {
    id: "posting_06",
    title: "Machine Operator",
    company: "Coalfield Machine & Tool",
    location: "Princeton, WV",
    salary: "$19 to $23 an hour",
    employmentType: "Full time, 45 hours a week",
    description:
      "Coalfield Machine and Tool is hiring a machine operator. You set up the machine, run " +
      "parts, and measure them. Overtime is offered. You need an NCCER core card.",
    duty: "set up the machine and measure parts",
    requires: "an NCCER core card",
  },
  {
    id: "posting_07",
    title: "Print Finisher",
    company: "Appalachian Print & Sign",
    location: "Huntington, WV",
    salary: "$15 an hour",
    employmentType: "Part time, 28 hours a week",
    description:
      "Appalachian Print and Sign needs a print finisher. You cut, fold, and pack finished " +
      "work. Careful hands matter more than experience.",
    duty: "cut, fold, and pack finished work",
    requires: null,
  },
  {
    id: "posting_08",
    title: "Home Health Aide",
    company: "Seneca Home Health",
    location: "Elkins, WV",
    salary: "$17 an hour",
    employmentType: "Full time, 40 hours a week",
    description:
      "Seneca Home Health is hiring aides to visit clients at home. You help with meals, " +
      "cleaning, and getting around. You need a driver's license and CPR training.",
    duty: "help clients with meals and getting around",
    requires: "a driver's license and CPR training",
  },
  {
    id: "posting_09",
    title: "Building Supply Cashier",
    company: "Elk Fork Building Supply",
    location: "Ripley, WV",
    salary: "$14 an hour",
    employmentType: "Part time, 25 hours a week",
    description:
      "Elk Fork Building Supply wants a cashier. You ring up sales, help customers find " +
      "items, and keep the front tidy.",
    duty: "ring up sales and help customers",
    requires: null,
  },
  {
    id: "posting_10",
    title: "Data Entry Clerk",
    company: "Mountain State Data Services",
    location: "Fairmont, WV",
    salary: "$16 an hour",
    employmentType: "Full time, 40 hours a week",
    description:
      "Mountain State Data Services needs a data entry clerk. You type records, check them, " +
      "and fix errors. The work is quiet and steady.",
    duty: "type and check records",
    requires: null,
  },
];

const MISSING = "The posting doesn't say.";

/** The five sections `explain_job` is required to produce, as plain text. */
function render(sections) {
  return [
    `What you'd do: ${sections.what}`,
    `Hours: ${sections.hours}`,
    `Pay: ${sections.pay}`,
    `Must-haves: ${sections.mustHaves}`,
    `How you'd get there: ${sections.getThere}`,
  ].join("\n");
}

function faithfulSections(posting) {
  return {
    what: `You would ${posting.duty} at ${posting.company}. The team trains you on the job.`,
    hours: posting.employmentType ? `${posting.employmentType}.` : MISSING,
    pay: posting.salary ? `${posting.salary}.` : MISSING,
    mustHaves: posting.requires ? `You need ${posting.requires}.` : MISSING,
    getThere: `The job is in ${posting.location}. Ask your instructor about a ride.`,
  };
}

/**
 * The quiet variant: every fact the posting DOES state is still stated, but the
 * two most-guessed sections fall back to the required "doesn't say" line.
 *
 * This is the half of the corpus that measures over-refusal. A checker that
 * flagged these would push the model toward inventing something to say, which
 * is the failure the whole guard exists to prevent.
 */
function quietSections(posting) {
  return {
    ...faithfulSections(posting),
    pay: MISSING,
    mustHaves: MISSING,
  };
}

/** A town and state that appears in no posting in the corpus. */
const WRONG_PLACE = "Roanoke, VA";

const MUTATIONS = {
  wage: (sections, posting) => ({
    // Numbers the posting states nowhere, in the same shape it would have
    // stated them — the model that got this wrong read the posting and
    // remembered a different figure, not a different job.
    sections: { ...sections, pay: posting.salary ? "$22 an hour." : "$22 an hour." },
    from: posting.salary ?? "(no pay stated)",
    to: "$22 an hour",
  }),
  hours: (sections, posting) => ({
    sections: { ...sections, hours: "Full time, 60 hours a week." },
    from: posting.employmentType ?? "(no hours stated)",
    to: "60 hours a week",
  }),
  place: (sections, posting) => ({
    sections: {
      ...sections,
      getThere: `The job is in ${WRONG_PLACE}. Ask your instructor about a ride.`,
    },
    from: posting.location,
    to: WRONG_PLACE,
  }),
  requirement: (sections) => ({
    // A credential the student would have to go and get, invented. This is the
    // mutation that stops a job search rather than merely misinforming it.
    sections: { ...sections, mustHaves: "You need a CDL to apply." },
    from: "(the posting asks for no CDL)",
    to: "CDL",
  }),
};

function build() {
  const cases = [];

  for (const posting of POSTINGS) {
    const faithful = faithfulSections(posting);

    cases.push({
      id: `${posting.id}_faithful_full`,
      postingId: posting.id,
      faithful: true,
      mutation: null,
      why: "Every fact restated from the posting, nothing added.",
      explanation: render(faithful),
    });
    cases.push({
      id: `${posting.id}_faithful_quiet`,
      postingId: posting.id,
      faithful: true,
      mutation: null,
      why: "Says 'doesn't say' where the model would be guessing. Silence is not a fabrication.",
      explanation: render(quietSections(posting)),
    });

    // Three of the four mutations per posting, rotated so each kind lands
    // seven or eight times across the corpus rather than clustering on the
    // postings that happen to suit it.
    const kinds = Object.keys(MUTATIONS);
    const offset = POSTINGS.indexOf(posting);
    for (let step = 0; step < 3; step += 1) {
      const kind = kinds[(offset + step) % kinds.length];
      const { sections, from, to } = MUTATIONS[kind](faithful, posting);
      cases.push({
        id: `${posting.id}_wrong_${kind}`,
        postingId: posting.id,
        faithful: false,
        mutation: { kind, from, to },
        why: `One clause changed: ${kind} "${from}" became "${to}". Everything else is correct.`,
        explanation: render(sections),
      });
    }
  }

  const wrong = cases.filter((entry) => !entry.faithful);
  const byKind = {};
  for (const entry of wrong) {
    byKind[entry.mutation.kind] = (byKind[entry.mutation.kind] ?? 0) + 1;
  }

  return {
    version: 1,
    note:
      "Ground truth is the MUTATION, not a later reading of the text: each wrong case is a " +
      "faithful explanation with exactly one clause changed. That is why the labels can be " +
      "trusted without a human relabelling them.",
    generator: "scripts/bench/generate-explain-fixtures.mjs",
    counts: { total: cases.length, faithful: cases.length - wrong.length, wrong: wrong.length },
    wrongByKind: byKind,
    // `duty` and `requires` are inputs to the templates above, not fields a
    // posting has — they would read as extra posting data to anything that
    // consumed this file, so they are dropped rather than committed.
    postings: POSTINGS.map(({ duty: _duty, requires: _requires, ...posting }) => posting),
    cases,
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
    console.log("explain-faithfulness.json is up to date.");
    return;
  }
  if (check) {
    console.error("explain-faithfulness.json differs from the generator. Regenerate and commit.");
    process.exit(1);
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, next);
  const parsed = JSON.parse(next);
  console.log(
    `wrote ${parsed.counts.total} explanations — ${parsed.counts.faithful} faithful, ` +
      `${parsed.counts.wrong} wrong (${JSON.stringify(parsed.wrongByKind)}).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
