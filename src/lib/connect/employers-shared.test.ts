import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPLOYER_STATUSES,
  LOCATION_NOT_LISTED,
  SUBSIDY_KEYS,
  dedupeEmployerNames,
  employerNameKey,
  humanizeCertId,
  opportunityToLeadInput,
  planEmployerBackfill,
  readSubsidyFlags,
  subsidyFlagsSchema,
} from "./employers-shared";

describe("employerNameKey", () => {
  it("case-folds, trims, and collapses whitespace", () => {
    assert.equal(employerNameKey("  Mountain   Metal  "), "mountain metal");
    assert.equal(employerNameKey("MOUNTAIN METAL"), "mountain metal");
    assert.equal(employerNameKey("Mountain Metal"), "mountain metal");
  });

  it("collapses non-breaking spaces and tabs, which paste in from job orders", () => {
    assert.equal(employerNameKey("Mountain Metal"), "mountain metal");
    assert.equal(employerNameKey("Mountain\tMetal"), "mountain metal");
  });

  it("returns an empty key for blank input so callers can drop it", () => {
    assert.equal(employerNameKey("   "), "");
    assert.equal(employerNameKey(null), "");
    assert.equal(employerNameKey(undefined), "");
  });

  it("keeps genuinely different employers apart", () => {
    assert.notEqual(employerNameKey("Mountain Metal"), employerNameKey("Mountain Metals"));
  });
});

describe("dedupeEmployerNames", () => {
  it("dedupes case-insensitively and keeps the first spelling seen", () => {
    const result = dedupeEmployerNames([
      "Mountain Metal",
      "mountain metal",
      "  MOUNTAIN   METAL ",
      "Valley Foods",
    ]);
    assert.deepEqual(result, [
      { name: "Mountain Metal", nameKey: "mountain metal" },
      { name: "Valley Foods", nameKey: "valley foods" },
    ]);
  });

  it("drops blanks and nullish entries rather than creating a nameless employer", () => {
    const result = dedupeEmployerNames(["", "   ", null, undefined, "Valley Foods"]);
    assert.deepEqual(result, [{ name: "Valley Foods", nameKey: "valley foods" }]);
  });

  it("is stable: running it over its own output changes nothing", () => {
    const once = dedupeEmployerNames(["Mountain Metal", "mountain metal"]);
    const twice = dedupeEmployerNames(once.map((row) => row.name));
    assert.deepEqual(twice, once);
  });
});

describe("opportunityToLeadInput", () => {
  const base = {
    id: "opp-1",
    title: "Production Associate",
    company: "Mountain Metal",
    location: "Beckley, WV",
    description: "Runs the press.",
    status: "open",
  };

  it("maps an open Opportunity onto an open lead with its provenance", () => {
    const lead = opportunityToLeadInput(base);
    assert.equal(lead.title, "Production Associate");
    assert.equal(lead.location, "Beckley, WV");
    assert.equal(lead.description, "Runs the press.");
    assert.equal(lead.source, "opportunity");
    assert.equal(lead.sourceRef, "opp-1");
    assert.equal(lead.status, "open");
    assert.equal(lead.employerNameKey, "mountain metal");
    assert.equal(lead.employerName, "Mountain Metal");
  });

  it("carries a closed Opportunity across as closed, not open", () => {
    const lead = opportunityToLeadInput({ ...base, status: "closed" });
    assert.equal(lead.status, "closed");
  });

  it("substitutes a plain placeholder rather than inventing a location", () => {
    const lead = opportunityToLeadInput({ ...base, location: null });
    assert.equal(lead.location, LOCATION_NOT_LISTED);
  });
});

describe("readSubsidyFlags", () => {
  it("reports every subsidy as unknown when nothing was recorded", () => {
    const flags = readSubsidyFlags({});
    for (const key of SUBSIDY_KEYS) {
      assert.equal(flags[key], "unknown", `${key} must default to unknown`);
    }
  });

  it("keeps a recorded known flag and ignores junk values", () => {
    const flags = readSubsidyFlags({ eip: "known", esp: "maybe", ojt: 7 });
    assert.equal(flags.eip, "known");
    assert.equal(flags.esp, "unknown", "an unrecognized value is not an assertion");
    assert.equal(flags.ojt, "unknown");
  });

  it("survives a null or non-object column value", () => {
    assert.equal(readSubsidyFlags(null).eip, "unknown");
    assert.equal(readSubsidyFlags("nope").eip, "unknown");
  });
});

describe("planEmployerBackfill", () => {
  const opportunity = {
    id: "opp-1",
    title: "Production Associate",
    company: "Mountain Metal",
    location: "Beckley, WV",
    description: null,
    status: "open",
  };

  it("merges the two free-text sources into one employer list", () => {
    const plan = planEmployerBackfill(
      [opportunity],
      [{ employerName: "mountain metal", unsubsidizedEmploymentAt: null }],
    );
    assert.equal(plan.employers.length, 1, "the same employer under two spellings is one row");
    assert.equal(plan.employers[0].name, "Mountain Metal");
  });

  it("marks an employer that appears in a placement record as having hired before", () => {
    const hired = new Date("2026-05-01T00:00:00.000Z");
    const plan = planEmployerBackfill(
      [opportunity, { ...opportunity, id: "opp-2", company: "Valley Foods" }],
      [{ employerName: "Mountain Metal", unsubsidizedEmploymentAt: hired }],
    );
    const byName = new Map(plan.employers.map((employer) => [employer.name, employer]));
    assert.equal(byName.get("Mountain Metal")?.hiredSpokesGradBefore, true);
    assert.deepEqual(byName.get("Mountain Metal")?.lastHiredAt, hired);
    assert.equal(byName.get("Valley Foods")?.hiredSpokesGradBefore, false);
    assert.equal(byName.get("Valley Foods")?.lastHiredAt, null);
  });

  it("keeps the LATEST hire date when an employer hired more than one graduate", () => {
    const plan = planEmployerBackfill(
      [],
      [
        { employerName: "Mountain Metal", unsubsidizedEmploymentAt: new Date("2026-01-05") },
        { employerName: "Mountain Metal", unsubsidizedEmploymentAt: new Date("2026-06-20") },
      ],
    );
    assert.deepEqual(plan.employers[0].lastHiredAt, new Date("2026-06-20"));
  });

  it("still marks a hire whose date was never recorded", () => {
    const plan = planEmployerBackfill(
      [],
      [{ employerName: "Mountain Metal", unsubsidizedEmploymentAt: null }],
    );
    assert.equal(plan.employers[0].hiredSpokesGradBefore, true);
    assert.equal(plan.employers[0].lastHiredAt, null);
  });

  it("plans one lead per opportunity, keyed by the opportunity id", () => {
    const plan = planEmployerBackfill(
      [opportunity, { ...opportunity, id: "opp-2", title: "Packer" }],
      [],
    );
    assert.deepEqual(plan.leads.map((lead) => lead.sourceRef), ["opp-1", "opp-2"]);
  });

  it("is deterministic: the same inputs plan the same rows", () => {
    const inputs = [
      [opportunity],
      [{ employerName: "Valley Foods", unsubsidizedEmploymentAt: null }],
    ] as const;
    assert.deepEqual(
      planEmployerBackfill([...inputs[0]], [...inputs[1]]),
      planEmployerBackfill([...inputs[0]], [...inputs[1]]),
    );
  });
});

describe("subsidyFlagsSchema", () => {
  it("accepts exactly the SUBSIDY_KEYS and nothing else", () => {
    // The schema is written out literally for type inference; this pins it to
    // SUBSIDY_KEYS so adding a sixth lever to one list fails until it is in both.
    const all = Object.fromEntries(SUBSIDY_KEYS.map((key) => [key, "known"]));
    assert.equal(subsidyFlagsSchema.safeParse(all).success, true);
    assert.deepEqual(
      Object.keys(subsidyFlagsSchema.shape).sort(),
      [...SUBSIDY_KEYS].sort(),
    );
    assert.equal(subsidyFlagsSchema.safeParse({ ...all, tax_credit: "known" }).success, false);
  });
});

describe("employer status vocabulary", () => {
  it("names exactly the three states the spec allows", () => {
    assert.deepEqual([...EMPLOYER_STATUSES], ["active", "paused", "do_not_contact"]);
  });
});

describe("humanizeCertId", () => {
  it("turns a catalog id into words a reason sentence can use", () => {
    assert.equal(humanizeCertId("forklift-operator"), "forklift operator");
    assert.equal(humanizeCertId("ready_to_work"), "ready to work");
  });
});
