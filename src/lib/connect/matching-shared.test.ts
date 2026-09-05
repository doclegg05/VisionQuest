import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";

import {
  HARD_BLOCK,
  fit,
  rankLeadFits,
  type MatchLead,
  type MatchStudent,
} from "./matching-shared";
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  emptyAvailability,
  type AvailabilityDay,
  type AvailabilityGrid,
  type AvailabilitySlot,
  type WorkProfile,
} from "./work-profile-shared";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function gridWith(spec: Partial<Record<AvailabilityDay, AvailabilitySlot[]>>): AvailabilityGrid {
  const grid = emptyAvailability();
  for (const [day, slots] of Object.entries(spec)) {
    for (const slot of slots ?? []) grid[day as AvailabilityDay][slot] = true;
  }
  return grid;
}

function fullGrid(): AvailabilityGrid {
  const grid = emptyAvailability();
  for (const day of AVAILABILITY_DAYS) {
    for (const slot of AVAILABILITY_SLOTS) grid[day][slot] = true;
  }
  return grid;
}

function profile(overrides: Partial<WorkProfile> = {}): WorkProfile {
  return {
    studentId: "stu-1",
    availability: fullGrid(),
    transport: "car",
    homeZip: null,
    county: "Raleigh",
    maxCommuteMinutes: null,
    payFloorHourly: null,
    childcareHours: null,
    earliestStart: null,
    shiftLimits: null,
    updatedAt: "2026-09-05T00:00:00.000Z",
    updatedVia: "student",
    ...overrides,
  };
}

function student(overrides: Partial<MatchStudent> = {}): MatchStudent {
  return {
    studentId: "stu-1",
    displayName: "Dana",
    workProfile: profile(),
    verifiedCertIds: [],
    discovery: { topClusters: ["career-readiness"], hollandCode: "RSC" },
    resumeSkills: [],
    classRegion: "Beckley, WV",
    withdrawnEmployerIds: [],
    ...overrides,
  };
}

function lead(overrides: Partial<MatchLead> = {}): MatchLead {
  return {
    id: "lead-1",
    title: "Production Associate",
    description: "Runs the press line.",
    employerId: "emp-1",
    employerName: "Mountain Metal",
    employerStatus: "active",
    employerHiredSpokesGradBefore: false,
    status: "open",
    location: "Beckley, WV",
    clusters: ["career-readiness"],
    requirements: { mustHaveCerts: [], niceToHave: [], physical: [], licenses: [] },
    schedule: { shifts: [] },
    payMin: null,
    payMax: null,
    payPeriod: "hour",
    transitNotes: null,
    distanceMiles: null,
    source: "manual",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hard blocks — one test per block in spec §5
// ---------------------------------------------------------------------------

describe("fit — hard blocks", () => {
  it("blocks when the student's declared availability misses every shift the lead names", () => {
    const result = fit(
      student({ workProfile: profile({ availability: gridWith({ saturday: ["morning"] }) }) }),
      lead({ schedule: { shifts: ["day"] } }),
    );
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.availabilityNoOverlap]);
    assert.equal(result.score, 0, "a blocked fit scores zero");
  });

  it("does NOT block on availability when the lead names no shifts", () => {
    const result = fit(
      student({ workProfile: profile({ availability: gridWith({ saturday: ["morning"] }) }) }),
      lead({ schedule: { shifts: [] } }),
    );
    assert.deepEqual(result.hardBlocks, []);
  });

  it("blocks on a must-have certification the student has not had verified", () => {
    const result = fit(
      student({ verifiedCertIds: [] }),
      lead({
        requirements: {
          mustHaveCerts: ["forklift-operator"],
          niceToHave: [],
          physical: [],
          licenses: [],
        },
      }),
    );
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.missingMustHaveCert]);
  });

  it("clears the cert block only for a VERIFIED cert — the caller passes verified ids only", () => {
    const requirements = {
      mustHaveCerts: ["forklift-operator"],
      niceToHave: [],
      physical: [],
      licenses: [],
    };
    assert.deepEqual(
      fit(student({ verifiedCertIds: ["forklift-operator"] }), lead({ requirements })).hardBlocks,
      [],
    );
    assert.deepEqual(
      fit(student({ verifiedCertIds: ["ready-to-work"] }), lead({ requirements })).hardBlocks,
      [HARD_BLOCK.missingMustHaveCert],
    );
  });

  it("blocks when the top of the lead's pay range is under the student's floor", () => {
    const result = fit(
      student({ workProfile: profile({ payFloorHourly: 15 }) }),
      lead({ payMin: 11, payMax: 12, payPeriod: "hour" }),
    );
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.payBelowFloor]);
  });

  it("compares a non-hourly pay period in hourly terms before blocking", () => {
    // $20,800 a year is $10.00/hr — under a $15 floor.
    assert.deepEqual(
      fit(
        student({ workProfile: profile({ payFloorHourly: 15 }) }),
        lead({ payMin: null, payMax: 20800, payPeriod: "year" }),
      ).hardBlocks,
      [HARD_BLOCK.payBelowFloor],
    );
    // $41,600 a year is $20.00/hr — above it.
    assert.deepEqual(
      fit(
        student({ workProfile: profile({ payFloorHourly: 15 }) }),
        lead({ payMin: null, payMax: 41600, payPeriod: "year" }),
      ).hardBlocks,
      [],
    );
  });

  it("does not block on pay the lead never stated", () => {
    const result = fit(
      student({ workProfile: profile({ payFloorHourly: 15 }) }),
      lead({ payMin: null, payMax: null }),
    );
    assert.deepEqual(result.hardBlocks, []);
  });

  it("blocks when the student has no way to get there and the lead names no transit", () => {
    const result = fit(
      student({ workProfile: profile({ transport: "none" }) }),
      lead({ transitNotes: null }),
    );
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.transportInfeasible]);
  });

  it("never blocks on transport when the lead names a transit route", () => {
    assert.deepEqual(
      fit(
        student({ workProfile: profile({ transport: "none" }) }),
        lead({ transitNotes: "Route 4 stops out front" }),
      ).hardBlocks,
      [],
    );
    assert.deepEqual(
      fit(
        student({ workProfile: profile({ transport: "walk" }) }),
        lead({ transitNotes: "Route 4 stops out front", distanceMiles: 12 }),
      ).hardBlocks,
      [],
    );
  });

  it("blocks a lead that is not open", () => {
    for (const status of ["filled", "paused", "closed"]) {
      assert.deepEqual(
        fit(student(), lead({ status })).hardBlocks,
        [HARD_BLOCK.leadNotOpen],
        `status ${status} must block`,
      );
    }
  });

  it("blocks an employer marked do_not_contact", () => {
    const result = fit(student(), lead({ employerStatus: "do_not_contact" }));
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.employerDoNotContact]);
  });

  it("blocks an employer this student already withdrew from", () => {
    const result = fit(student({ withdrawnEmployerIds: ["emp-1"] }), lead());
    assert.deepEqual(result.hardBlocks, [HARD_BLOCK.studentWithdrewFromEmployer]);
  });

  it("reports every applicable block, not just the first", () => {
    const result = fit(
      student({
        workProfile: profile({ transport: "none", payFloorHourly: 20 }),
        withdrawnEmployerIds: ["emp-1"],
      }),
      lead({ status: "closed", employerStatus: "do_not_contact", payMax: 9 }),
    );
    assert.deepEqual(
      [...result.hardBlocks].sort(),
      [
        HARD_BLOCK.employerDoNotContact,
        HARD_BLOCK.leadNotOpen,
        HARD_BLOCK.payBelowFloor,
        HARD_BLOCK.studentWithdrewFromEmployer,
        HARD_BLOCK.transportInfeasible,
      ].sort(),
    );
  });
});

describe("fit — a student who has answered nothing", () => {
  // The five-question intake is optional and most students will not have done
  // it on day one. Missing answers must lower the score, never hide the job.
  it("is never hard-blocked on availability, transport, or pay", () => {
    const result = fit(
      student({ workProfile: null }),
      lead({ schedule: { shifts: ["night"] }, payMin: 9, payMax: 9 }),
    );
    assert.deepEqual(result.hardBlocks, []);
  });

  it("is not hard-blocked when the grid exists but nothing in it is ticked", () => {
    const result = fit(
      student({ workProfile: profile({ availability: emptyAvailability(), transport: null }) }),
      lead({ schedule: { shifts: ["day"] } }),
    );
    assert.deepEqual(result.hardBlocks, []);
  });

  it("still hard-blocks on facts that do not depend on the student's answers", () => {
    assert.deepEqual(fit(student({ workProfile: null }), lead({ status: "closed" })).hardBlocks, [
      HARD_BLOCK.leadNotOpen,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Soft score
// ---------------------------------------------------------------------------

describe("fit — soft score", () => {
  it("rises with the share of the shift the student can actually cover", () => {
    const dayShift = lead({ schedule: { shifts: ["day"] } });
    const half = fit(
      student({
        workProfile: profile({
          availability: gridWith({
            monday: ["morning", "afternoon"],
            tuesday: ["morning", "afternoon"],
            wednesday: ["morning"],
          }),
        }),
      }),
      dayShift,
    );
    const all = fit(student(), dayShift);
    assert.ok(
      all.score > half.score,
      `full availability (${all.score}) must beat partial (${half.score})`,
    );
  });

  it("gives a verified nice-to-have certification a bonus, and an unverified one nothing", () => {
    const withCert = lead({
      requirements: {
        mustHaveCerts: [],
        niceToHave: ["forklift-operator"],
        physical: [],
        licenses: [],
      },
    });
    const verified = fit(student({ verifiedCertIds: ["forklift-operator"] }), withCert);
    const notVerified = fit(student({ verifiedCertIds: [] }), withCert);
    assert.ok(
      verified.score > notVerified.score,
      `verified (${verified.score}) must beat unverified (${notVerified.score})`,
    );
  });

  it("rewards an employer that has hired a SPOKES graduate before", () => {
    const before = fit(student(), lead({ employerHiredSpokesGradBefore: true }));
    const never = fit(student(), lead({ employerHiredSpokesGradBefore: false }));
    assert.ok(before.score > never.score);
  });

  it("rewards pay above the student's floor", () => {
    const floor = student({ workProfile: profile({ payFloorHourly: 12 }) });
    const above = fit(floor, lead({ payMin: 18, payMax: 20 }));
    const unstated = fit(floor, lead({ payMin: null, payMax: null }));
    assert.ok(above.score > unstated.score);
  });

  it("clamps to 100 for a lead that matches on every axis", () => {
    const result = fit(
      student({
        verifiedCertIds: ["forklift-operator", "ready-to-work"],
        resumeSkills: ["forklift", "press operation", "safety"],
        workProfile: profile({ payFloorHourly: 10 }),
      }),
      lead({
        employerHiredSpokesGradBefore: true,
        payMin: 22,
        payMax: 26,
        schedule: { shifts: ["day"] },
        description: "Forklift and press operation with a safety focus.",
        requirements: {
          mustHaveCerts: ["forklift-operator"],
          niceToHave: ["ready-to-work"],
          physical: [],
          licenses: [],
        },
      }),
    );
    assert.equal(result.score, 100);
  });

  it("never returns a score outside 0..100", () => {
    for (const candidate of [
      fit(student({ workProfile: null, discovery: null }), lead()),
      fit(student(), lead({ status: "closed" })),
      fit(student(), lead()),
    ]) {
      assert.ok(candidate.score >= 0 && candidate.score <= 100, `score ${candidate.score}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Location — an instructor-entered lead is local by construction
// ---------------------------------------------------------------------------

describe("fit — lead proximity", () => {
  // The class region is recorded as a county; an instructor types the town.
  // The shared scorer's text match fails on that pair, which used to cost a
  // real local employer the whole 40-point location axis.
  const CLASS_REGION = "Kanawha County, WV";
  const TOWN = "Charleston, WV";

  it("scores a hand-typed lead in the county's town as local", () => {
    const typed = fit(
      student({ classRegion: CLASS_REGION, discovery: null, workProfile: null }),
      lead({ location: TOWN, source: "manual", clusters: [] }),
    );
    const control = fit(
      student({ classRegion: CLASS_REGION, discovery: null, workProfile: null }),
      lead({ location: CLASS_REGION, source: "manual", clusters: [] }),
    );
    assert.equal(
      typed.score,
      control.score,
      "an instructor typing the town instead of the county must not lose the location axis",
    );
    assert.ok(typed.score > 0, `expected a local score, got ${typed.score}`);
  });

  it("treats a MACC job order and a converted Opportunity the same way", () => {
    for (const source of ["joborder", "opportunity"]) {
      const result = fit(
        student({ classRegion: CLASS_REGION, discovery: null, workProfile: null }),
        lead({ location: TOWN, source, clusters: [] }),
      );
      assert.ok(result.score > 0, `${source} lead scored ${result.score}`);
    }
  });

  it("keeps the scraped heuristic for a lead made from a job posting", () => {
    // joblisting-sourced leads carry the adapters' own unverified location
    // text, so they must not be promoted to "local" on the strength of an
    // instructor having clicked a button.
    const scraped = fit(
      student({ classRegion: CLASS_REGION, discovery: null, workProfile: null }),
      lead({ location: TOWN, source: "joblisting", clusters: [] }),
    );
    const typed = fit(
      student({ classRegion: CLASS_REGION, discovery: null, workProfile: null }),
      lead({ location: TOWN, source: "manual", clusters: [] }),
    );
    assert.ok(
      typed.score > scraped.score,
      `typed ${typed.score} must beat scraped ${scraped.score} on the same location text`,
    );
  });

  it("does not invent a location score when the class has no region recorded", () => {
    const result = fit(
      student({ classRegion: "", discovery: null, workProfile: null }),
      lead({ location: TOWN, source: "manual", clusters: [] }),
    );
    assert.equal(result.score, 0, "no region means we do not know, not that it is close");
  });
});

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

describe("fit — reasons", () => {
  const rich = () =>
    fit(
      student({
        verifiedCertIds: ["forklift-operator"],
        workProfile: profile({ payFloorHourly: 12, transport: "bus" }),
      }),
      lead({
        schedule: { shifts: ["day"] },
        payMin: 15,
        payMax: 15,
        transitNotes: "Route 4 stops out front",
        employerHiredSpokesGradBefore: true,
        requirements: {
          mustHaveCerts: ["forklift-operator"],
          niceToHave: [],
          physical: [],
          licenses: [],
        },
      }),
    );

  it("says the shift in plain words", () => {
    assert.ok(
      rich().reasons.some((reason) => reason.includes("Day shift")),
      rich().reasons.join(" | "),
    );
  });

  it("names the certification the student actually earned", () => {
    assert.ok(
      rich().reasons.some((reason) => reason.includes("forklift operator")),
      rich().reasons.join(" | "),
    );
  });

  it("states the pay as an hourly figure above the floor", () => {
    const reasons = rich().reasons.join(" | ");
    assert.ok(reasons.includes("$15 an hour"), reasons);
    assert.ok(reasons.includes("Above the pay you need."), reasons);
  });

  it("reads at or below a 6th-grade level", () => {
    const text = rich().reasons.join(" ");
    const readability = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(
      readability.withinTarget,
      `reasons scored grade ${readability.grade}: ${text}`,
    );
  });

  it("describes a past withdrawal as a situation, not as something the student did", () => {
    const blocked = fit(student({ withdrawnEmployerIds: ["emp-1"] }), lead());
    assert.deepEqual(blocked.blockReasons, [
      "This employer came up for them before and it didn't work out.",
    ]);
    assert.ok(
      !blocked.blockReasons.join(" ").toLowerCase().includes("backed out"),
      "the record shows an application that ended, not who ended it",
    );
  });

  it("names a required certification without ever rendering 'undefined'", () => {
    const blocked = fit(
      student({ verifiedCertIds: [] }),
      lead({
        requirements: {
          mustHaveCerts: ["forklift-operator"],
          niceToHave: [],
          physical: [],
          licenses: [],
        },
      }),
    );
    assert.equal(blocked.blockReasons[0], "Needs the forklift operator card. Not earned yet.");
    assert.ok(!blocked.blockReasons.join(" ").includes("undefined"));
  });

  it("explains a block in the same plain words", () => {
    const blocked = fit(
      student({ workProfile: profile({ transport: "none" }) }),
      lead({ transitNotes: null }),
    );
    assert.deepEqual(blocked.blockReasons, ["No way to get there yet."]);
    const readability = assessReadability(blocked.blockReasons.join(" ") + " " + blocked.blockReasons.join(" "), {
      maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE,
    });
    assert.ok(readability.withinTarget, `grade ${readability.grade}`);
  });

  it("gives every block code a sentence, so the console can never show a bare code", () => {
    const everyBlock = fit(
      student({
        workProfile: profile({
          transport: "none",
          payFloorHourly: 20,
          availability: gridWith({ saturday: ["morning"] }),
        }),
        withdrawnEmployerIds: ["emp-1"],
        verifiedCertIds: [],
      }),
      lead({
        status: "closed",
        employerStatus: "do_not_contact",
        payMax: 9,
        schedule: { shifts: ["day"] },
        requirements: {
          mustHaveCerts: ["forklift-operator"],
          niceToHave: [],
          physical: [],
          licenses: [],
        },
      }),
    );
    assert.equal(everyBlock.hardBlocks.length, 7, everyBlock.hardBlocks.join(","));
    assert.equal(everyBlock.blockReasons.length, everyBlock.hardBlocks.length);
    for (const reason of everyBlock.blockReasons) {
      assert.ok(reason.length > 0 && reason.endsWith("."), reason);
    }
  });
});

describe("rankLeadFits — the order a student actually sees", () => {
  // This is the whole student-facing ranking, lifted out of
  // `rankLeadsForStudent` so it can be exercised (and benchmarked) without a
  // database. The three properties below are what the `matching-quality`
  // benchmark's precision@3 is a statement about, so they are pinned here
  // rather than left implicit in the query that used to contain them.

  it("drops every hard-blocked lead rather than ranking it last", () => {
    const blocked = lead({ id: "lead-blocked", status: "closed" });
    const open = lead({ id: "lead-open" });

    const ranked = rankLeadFits(student({}), [blocked, open]);

    assert.deepEqual(
      ranked.map((entry) => entry.lead.id),
      ["lead-open"],
    );
  });

  it("puts the best score first", () => {
    // Same student, two leads differing only in whether the employer has hired
    // a SPOKES grad before — an 8-point bonus, so the order is decided.
    const plain = lead({ id: "lead-b", employerHiredSpokesGradBefore: false });
    const better = lead({ id: "lead-a", employerHiredSpokesGradBefore: true });

    const ranked = rankLeadFits(student({}), [plain, better]);

    assert.equal(ranked[0].lead.id, "lead-a");
    assert.ok(ranked[0].fit.score > ranked[1].fit.score);
  });

  it("breaks ties on lead id, so the top three never depend on input order", () => {
    // Not cosmetic. The shared sub-scorers are coarse and identical scores are
    // common; without a deterministic second key the top three would follow
    // whatever order the rows arrived in, and precision@3 would flap between
    // runs on unchanged code.
    const a = lead({ id: "lead-aaa" });
    const b = lead({ id: "lead-bbb" });
    const c = lead({ id: "lead-ccc" });

    const ascending = rankLeadFits(student({}), [a, b, c]).map((entry) => entry.lead.id);
    const descending = rankLeadFits(student({}), [c, b, a]).map((entry) => entry.lead.id);

    assert.deepEqual(ascending, ["lead-aaa", "lead-bbb", "lead-ccc"]);
    assert.deepEqual(descending, ascending);
  });
});
