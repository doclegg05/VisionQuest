// =============================================================================
// The guard between a model's mistake and a student acting on it.
//
// `explain_job` refuses its own draft when the draft states a fact the posting
// does not support. Both directions cost something real, so both are pinned
// here: a missed fabrication reaches a student as fact, and a false refusal
// takes away an explanation that was correct and sends them to their
// instructor for it.
//
// The `explain-faithfulness-check` benchmark scores the same checker over 50
// generated explanations. These cases are the mechanism-level guards — the
// specific shapes that have to keep working for that number to mean anything.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkExplanationFaithfulness,
  ungroundedDollarValues,
  BARE_RATE,
  CITY_STATE,
  MONEY_PATTERNS,
  MAX_CHECKED_CHARS,
  type ExplainPosting,
} from "./explain-faithfulness";

const POSTING: ExplainPosting = {
  title: "Warehouse Selector",
  company: "Blackwater Logistics",
  location: "Charleston, WV",
  salary: "$16 an hour",
  employmentType: "Part time, 24 hours a week",
  description:
    "Blackwater Logistics is hiring a warehouse selector for evenings. You pull orders and " +
    "load pallets. A forklift card helps but is not required.",
};

function kinds(draft: string, posting: ExplainPosting = POSTING) {
  return checkExplanationFaithfulness(draft, posting).map((finding) => finding.kind);
}

describe("wage", () => {
  it("passes a figure the posting states", () => {
    assert.deepEqual(kinds("Pay: $16 an hour."), []);
  });

  it("catches a figure the posting never states", () => {
    assert.deepEqual(kinds("Pay: $22 an hour."), ["wage"]);
  });

  it("allows rounding a posted rate to whole dollars", () => {
    // Rounding is not fabricating. The tolerance exists so a model that writes
    // "about $16" over a posted "$15.50" is not refused.
    assert.deepEqual(
      kinds("Pay: $16 an hour.", { ...POSTING, salary: "$15.50 an hour" }),
      [],
    );
  });

  it("reads money the posting wrote out in words", () => {
    // The original guard understood only "$15" and was bypassed by a model
    // simply writing the number out — and refused a correct explanation
    // whenever the POSTING wrote it out instead.
    assert.deepEqual(
      ungroundedDollarValues("Pay: $16 an hour.", {
        salary: null,
        description: "This job pays 16 dollars an hour.",
      }),
      [],
    );
  });
});

describe("hours", () => {
  it("passes the hours the posting states", () => {
    assert.deepEqual(kinds("Hours: Part time, 24 hours a week."), []);
  });

  it("catches hours the posting never states", () => {
    assert.deepEqual(kinds("Hours: Full time, 60 hours a week."), ["hours"]);
  });

  it("does not treat a bare number as a schedule", () => {
    // "40 pounds" is not forty hours. Requiring the unit word is what keeps
    // this check from refusing explanations over lifting limits and bus routes.
    assert.deepEqual(kinds("What you'd do: You lift boxes up to 40 pounds."), []);
  });
});

describe("place", () => {
  it("passes the town the posting names", () => {
    assert.deepEqual(kinds("How you'd get there: The job is in Charleston, WV."), []);
  });

  it("catches a town the posting never names", () => {
    assert.deepEqual(kinds("How you'd get there: The job is in Roanoke, VA."), ["place"]);
  });

  it("does not fire on a draft that names no town", () => {
    assert.deepEqual(kinds("How you'd get there: Ask your instructor about a ride."), []);
  });

  it("KNOWN LIMIT: a wrong town with no state after it is not caught", () => {
    // Recorded rather than papered over. Catching a bare "in Roanoke" means
    // deciding whether every capitalised word after "in" is a place, which
    // starts refusing drafts over "in September" and "at Mountain Metal". The
    // grounding block hands the model "Location: Charleston, WV", so a rewrite
    // that names a town almost always names it in that form — and this case
    // exists so the gap is a thing somebody can point at rather than a
    // surprise.
    assert.deepEqual(kinds("How you'd get there: The job is in Roanoke."), []);
  });
});

describe("requirements", () => {
  it("passes a credential the posting asks for", () => {
    assert.deepEqual(kinds("Must-haves: A forklift card helps."), []);
  });

  it("catches a credential the posting never asks for", () => {
    assert.deepEqual(kinds("Must-haves: You need a CDL to apply."), ["requirement"]);
  });

  it("allows saying a credential is NOT needed", () => {
    // The most reassuring sentence this tool can write for a student who is
    // worried about exactly that, and refusing it would train the model out of
    // saying it.
    assert.deepEqual(kinds("Must-haves: You do not need a CDL for this job."), []);
  });

  it("does not let a negation in another section suppress the check", () => {
    // THE BUG THIS CASE EXISTS FOR. The negation window was a fixed 40
    // characters, and the five sections sit one per line — so "Pay: The
    // posting doesn't say." put "doesn't" just behind a CDL invented in the
    // NEXT section, and a fabricated credential went undetected because of a
    // sentence about the pay. Found by the explain-faithfulness-check
    // benchmark on its first run, at 29/30 recall.
    const draft = [
      "Hours: Part time, 24 hours a week.",
      "Pay: The posting doesn't say.",
      "Must-haves: You need a CDL to apply.",
    ].join("\n");

    assert.deepEqual(kinds(draft), ["requirement"]);
  });
});

describe("the whole check", () => {
  it("says nothing about a draft that only restates the posting", () => {
    const draft = [
      "What you'd do: You would pull orders and load pallets at Blackwater Logistics.",
      "Hours: Part time, 24 hours a week.",
      "Pay: $16 an hour.",
      "Must-haves: The posting doesn't say.",
      "How you'd get there: The job is in Charleston, WV. Ask your instructor about a ride.",
    ].join("\n");

    assert.deepEqual(checkExplanationFaithfulness(draft, POSTING), []);
  });

  it("never fires on silence", () => {
    // The prompt tells the model to write "The posting doesn't say." for a
    // missing fact. A check that punished that would push it the other way,
    // which is the behaviour the whole guard exists to prevent.
    const draft = [
      "What you'd do: The posting doesn't say.",
      "Hours: The posting doesn't say.",
      "Pay: The posting doesn't say.",
      "Must-haves: The posting doesn't say.",
      "How you'd get there: The posting doesn't say.",
    ].join("\n");

    assert.deepEqual(checkExplanationFaithfulness(draft, POSTING), []);
  });

  it("reports every invented fact, not only the first", () => {
    const draft = [
      "Hours: Full time, 60 hours a week.",
      "Pay: $22 an hour.",
      "How you'd get there: The job is in Roanoke, VA.",
    ].join("\n");

    assert.deepEqual(kinds(draft).sort(), ["hours", "place", "wage"]);
  });
});

// =============================================================================
// Code review, 2026-09-05. Each block below reproduces a defect a reviewer
// executed against the shipped checker, with the reviewer's own inputs.
// =============================================================================

describe("credentials are matched as words, not as substrings", () => {
  // CRITICAL. `haystack.indexOf(alias)` matched "ged" inside "changed",
  // "managed", "encouraged" -- so the check both REFUSED true drafts and
  // ACCEPTED the fabrication it exists to catch, from the same bug.

  it("does not refuse a true draft over the letters g-e-d inside an ordinary word", () => {
    const draft =
      "What it is: You pull orders and load pallets.\n" +
      "Pay: $16 an hour.\n" +
      "Hours: 24 hours a week.\n" +
      "Where: Charleston, WV.\n" +
      "What you need: Nothing special to start.\n" +
      "Good to know: Your schedule can be changed by your shift lead.";
    assert.deepEqual(checkExplanationFaithfulness(draft, POSTING), []);
  });

  it("still catches a fabricated GED when the posting only contains 'managed'", () => {
    // The posting grounds nothing; "managed" must not launder "ged" through the
    // source side of the same substring match.
    const posting = {
      ...POSTING,
      salary: null,
      employmentType: null,
      description: "You will be managed by a shift lead. Load trucks.",
    };
    assert.deepEqual(kinds("What you need: You must have a GED.", posting), ["requirement"]);
  });

  const ORDINARY_WORDS = [
    "changed",
    "managed",
    "encouraged",
    "arranged",
    "damaged",
    "engaged",
    "logged",
    "tagged",
    "aged",
    "packaged",
  ];

  for (const word of ORDINARY_WORDS) {
    it(`does not read a credential out of "${word}"`, () => {
      assert.deepEqual(kinds(`Good to know: Shifts are ${word} by the shift lead.`), []);
    });
  }
});

describe("negation is read across the whole clause, not only before the term", () => {
  // WARNING. "A CDL is not required." was refused because the negation sits
  // after the credential. Reassurance about a card a student does not have is
  // the most useful sentence this tool can write; refusing it trains the model
  // out of writing it.

  it("accepts a negation that follows the credential", () => {
    assert.deepEqual(kinds("What you need: A CDL is not required."), []);
  });

  it("accepts a negation that precedes the credential", () => {
    assert.deepEqual(kinds("What you need: No CDL needed."), []);
  });

  it("accepts a contracted negation before the credential", () => {
    assert.deepEqual(kinds("What you need: You don't need a CDL."), []);
  });

  it("still refuses a credential invented in the section after a negated one", () => {
    // The clamp that made this work stays: the "doesn't" belongs to the pay
    // line, and must not reach across the line break to excuse the CDL.
    assert.deepEqual(kinds("Pay: The posting doesn't say.\nWhat you need: a CDL."), [
      "requirement",
    ]);
  });
});

describe("a place is the whole 'City, ST', not the city alone", () => {
  // WARNING. The check captured the state and then dropped it, so a draft that
  // moved the job to another state was accepted as long as the town name
  // matched. A student drives to the wrong Beckley.

  const BECKLEY = {
    ...POSTING,
    location: "Beckley, WV",
    description: "Evening warehouse work in Beckley.",
  };

  it("refuses the right town in the wrong state", () => {
    assert.deepEqual(kinds("Where: Beckley, VA.", BECKLEY), ["place"]);
  });

  it("accepts the town the posting names", () => {
    assert.deepEqual(kinds("Where: Beckley, WV.", BECKLEY), []);
  });

  it("still does not attempt a bare town name", () => {
    // The documented limit, pinned so a later reader sees it is a decision.
    assert.deepEqual(kinds("Where: the job is in Bluefield.", BECKLEY), []);
  });
});

describe("a wage written out in words is still a wage", () => {
  // SUGGESTION, taken rather than documented: the numeral check was trivially
  // bypassed by spelling the number out, which is exactly the shape an
  // injected instruction would use.

  it("catches a spelled-out figure the posting never states", () => {
    assert.deepEqual(kinds("Pay: twenty-five dollars an hour."), ["wage"]);
  });

  it("accepts the posted figure spelled out", () => {
    assert.deepEqual(kinds("Pay: sixteen dollars an hour."), []);
  });

  it("accepts a spelled-out figure the posting itself spells out", () => {
    const posting = { ...POSTING, salary: null, description: "Pay is twenty dollars an hour." };
    assert.deepEqual(kinds("Pay: twenty dollars an hour.", posting), []);
  });

  it("does not read a wage out of a spelled-out number with no money word", () => {
    assert.deepEqual(kinds("Good to know: You work with about twenty other people."), []);
  });
});

// =============================================================================
// ReDoS. A super-linear pattern here is reachable by whoever writes a job
// posting: `explain_job` reads third-party feed text, and the checks run over
// it before anything reaches a student.
//
// These drive `matchAll` with the `g` flag, because that is what production
// does (`numbersMatching`, `ungroundedPlaces`) and a benchmark should measure
// the call the code actually makes.
//
// But be clear about why the earlier version of this block missed a live
// quadratic, because the tempting explanation is the wrong one. It was NOT
// `.test()` vs `matchAll`: measured on the old pattern over the comma-run
// input, `.test()` costs 158 ms at 10 KB and `matchAll` 157 ms — identical,
// because with no match anywhere `.test()` has to try every start position
// too. The miss was INPUT COVERAGE. The old cases only ever fed these patterns
// whitespace-shaped attacks, so the digit/comma quantifier was never put under
// load by anything. A timing test is only as good as the input classes it
// tries, and "we have a ReDoS test" is not the same as "we tried the shape
// that breaks it".
//
// What they pin is GROWTH, not a stopwatch reading: a wall-clock threshold on a
// shared CI runner would flake, but across a 4x input a quadratic pattern grows
// ~16x and a linear one ~4x, and no amount of machine noise closes that gap.
// =============================================================================

/**
 * Big enough that the quadratic signal dwarfs timer noise. The fixed patterns
 * cost well under a millisecond at 40 KB, so this is cheap until it regresses,
 * which is exactly when it should stop being cheap.
 */
const REDOS_SIZES = [10_000, 20_000, 40_000];

function repeatTo(unit: string, n: number): string {
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
}

/** Best of three, so a scheduler hiccup cannot manufacture a failure. */
function bestMatchAllMillis(pattern: RegExp, input: string): number {
  const probe = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let best = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const started = process.hrtime.bigint();
    // Counted, not discarded: iterating is the work being measured, and an
    // unused loop body is the kind of thing an optimiser is entitled to drop.
    let _seen = 0;
    for (const _match of input.matchAll(probe)) _seen += 1;
    best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
  }
  return best;
}

/**
 * How much slower the pattern gets when its input grows four-fold.
 *
 * Linear is 4, quadratic is 16. The floor on the baseline keeps a
 * sub-microsecond first reading from turning into a meaningless ratio.
 */
function growthRatio(pattern: RegExp, attack: (n: number) => string): number {
  const times = REDOS_SIZES.map((n) => bestMatchAllMillis(pattern, attack(n)));
  return times[times.length - 1] / Math.max(times[0], 0.01);
}

/** Above linear (4) with headroom, far below the ~16 a quadratic pattern hits. */
const LINEAR_ENOUGH = 10;

/** The second money pattern -- the `dollars|usd` one -- by index, named once. */
const MONEY_DOLLARS_WORD = MONEY_PATTERNS[1];

describe("the patterns stay linear on adversarial input", () => {
  it("BARE_RATE does not blow up on a run of digits and commas", () => {
    // The one `.test()` hid. `\d[\d,]*` swallowed the whole tail from each of
    // ~n digit positions and gave it back a character at a time:
    // 154 ms at 10 KB, 9.9 s at 80 KB. A posting is third-party text, so that
    // was CPU whoever wrote the posting got to choose the length of.
    const ratio = growthRatio(BARE_RATE, (n) => repeatTo("1,", n));
    assert.ok(ratio < LINEAR_ENOUGH, `BARE_RATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("the dollars/usd money pattern does not blow up on the same run", () => {
    // Same sub-pattern, same fault, one copy over. It is in this list because
    // fixing only the pattern that was reported would have left the identical
    // quadratic reachable through the same `ungroundedDollarValues` call.
    const ratio = growthRatio(MONEY_DOLLARS_WORD, (n) => repeatTo("1,", n));
    assert.ok(ratio < LINEAR_ENOUGH, `MONEY dollars/usd grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("BARE_RATE does not blow up on a long run of bare digits", () => {
    const ratio = growthRatio(BARE_RATE, (n) => "1".repeat(n));
    assert.ok(ratio < LINEAR_ENOUGH, `BARE_RATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("BARE_RATE does not blow up on a rate word followed by spaces", () => {
    // The earlier fault, kept pinned: `per\s+` beside `\s*` gave back one
    // space and re-consumed the rest. 86 ms at 10 KB, 8.5 s at 80 KB.
    const ratio = growthRatio(BARE_RATE, (n) => `1 per ${" ".repeat(Math.max(0, n - 6))}`);
    assert.ok(ratio < LINEAR_ENOUGH, `BARE_RATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("BARE_RATE does not blow up on repeated rate phrases", () => {
    const ratio = growthRatio(BARE_RATE, (n) => repeatTo("1 per ", n));
    assert.ok(ratio < LINEAR_ENOUGH, `BARE_RATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("CITY_STATE does not blow up on capitalised prose with no state after it", () => {
    // The old `(?:[ -][A-Z][a-z]+)*` walked every remaining word from every
    // start position: 49 ms at 10 KB, 3 s at 80 KB.
    const ratio = growthRatio(CITY_STATE, (n) => repeatTo("Aa ", n));
    assert.ok(ratio < LINEAR_ENOUGH, `CITY_STATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("CITY_STATE does not blow up on hyphenated capitalised prose", () => {
    const ratio = growthRatio(CITY_STATE, (n) => repeatTo("Aa-", n));
    assert.ok(ratio < LINEAR_ENOUGH, `CITY_STATE grew ${ratio.toFixed(1)}x over a 4x input`);
  });

  it("still reads every wage and place form it exists to read", () => {
    // A bound is only safe if it changed nothing real. The grouped/ungrouped
    // pair matters most: a comma-grouped-only number pattern would have
    // silently stopped reading "1200 dollars", which is an ordinary way to
    // write a monthly wage, and a student would have lost a correct answer.
    const posting = (description: string) => ({ ...POSTING, salary: null, description });
    assert.deepEqual(kinds("Pay: $16 an hour."), []);
    assert.deepEqual(kinds("Pay: $18 an hour.", posting("Pays 18/hr.")), []);
    assert.deepEqual(kinds("Pay: $18 an hour.", posting("Pays 18 per hour.")), []);
    assert.deepEqual(kinds("Pay: $1200 a month.", posting("Pays 1200 dollars a month.")), []);
    assert.deepEqual(kinds("Pay: $1,200 a month.", posting("Pays $1,200 a month.")), []);
    assert.deepEqual(kinds("Pay: $15.50 an hour.", posting("Pays 15.50 dollars an hour.")), []);
    assert.deepEqual(kinds("Pay: $12345 a year.", posting("Pays 12345 dollars a year.")), []);
    assert.deepEqual(kinds("Pay: $1,234,567 a year.", posting("Pays $1,234,567 a year.")), []);
    assert.deepEqual(kinds("Pay: $22 an hour.", posting("Pays usd 22 an hour.")), []);
    assert.deepEqual(kinds("Where: Charleston, WV."), []);
  });

  it("still refuses a wage the posting never states", () => {
    // The bound must not have turned the check off.
    assert.deepEqual(
      kinds("Pay: $37 an hour.", { ...POSTING, salary: null, description: "Pays 1200 dollars a month." }),
      ["wage"],
    );
  });
});

describe("the checked text is bounded", () => {
  it("stops reading a posting past the cap", () => {
    // Truncating the SOURCE can only make the check stricter: the wage sits
    // past the cut, so it no longer grounds the draft and the draft is refused.
    // Refusing is the safe direction, which is why the cap is not a hole.
    const posting: ExplainPosting = {
      ...POSTING,
      salary: null,
      description: `${"filler. ".repeat(MAX_CHECKED_CHARS / 4)}Pays $37 an hour.`,
    };
    assert.ok(posting.description.length > MAX_CHECKED_CHARS);
    assert.deepEqual(kinds("Pay: $37 an hour.", posting), ["wage"]);
  });

  it("reads a posting that fits under the cap normally", () => {
    const posting: ExplainPosting = {
      ...POSTING,
      salary: null,
      description: "Pays $37 an hour. Evening shifts.",
    };
    assert.deepEqual(kinds("Pay: $37 an hour.", posting), []);
  });
});
