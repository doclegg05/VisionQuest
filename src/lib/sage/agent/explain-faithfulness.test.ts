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
} from "./explain-faithfulness";

const POSTING = {
  title: "Warehouse Selector",
  company: "Blackwater Logistics",
  location: "Charleston, WV",
  salary: "$16 an hour",
  employmentType: "Part time, 24 hours a week",
  description:
    "Blackwater Logistics is hiring a warehouse selector for evenings. You pull orders and " +
    "load pallets. A forklift card helps but is not required.",
};

function kinds(draft: string, posting = POSTING) {
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
