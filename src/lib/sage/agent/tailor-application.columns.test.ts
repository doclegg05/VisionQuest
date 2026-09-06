// =============================================================================
// WHICH column a tailored résumé and cover letter are keyed on.
//
// `ResumeVersion` and `CoverLetter` each carry two nullable FKs — one to a
// scraped `JobListing`, one to a Match & Connect `JobLead` — and exactly one
// must be set. The first cut of the Phase 4 packet passed a JobLead id into
// `jobListingId` and tried to re-key the rows afterwards: the FK rejected the
// insert with P2003, the re-key never ran, and a bare catch turned every
// packet into one with no résumé at all, silently, on every introduction the
// program made.
//
// The discriminated `TailoringTarget` makes that unrepresentable in the type
// system; these cases pin the write it produces, because the type says which
// KIND was asked for and only the payload says which COLUMN was written.
// =============================================================================

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const resumeCreates: Array<Record<string, unknown>> = [];
const letterCreates: Array<Record<string, unknown>> = [];
const versionScans: Array<Record<string, unknown>> = [];

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      resumeVersion: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          versionScans.push(args.where);
          return null;
        },
        create: async (args: { data: Record<string, unknown> }) => {
          resumeCreates.push(args.data);
          return { id: "rv1" };
        },
      },
      coverLetter: {
        findFirst: async () => null,
        create: async (args: { data: Record<string, unknown> }) => {
          letterCreates.push(args.data);
          return { id: "cl1" };
        },
      },
      // The two creates are one unit: a résumé with no cover letter is not a
      // tailored application.
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
  },
});

// A provider that returns a plan quoting only facts the source supplies, so
// the grounding assertions pass and the columns are what is under test.
mock.module("@/lib/ai/provider", {
  namedExports: {
    resolveAiProvider: async () => ({
      name: "ollama",
      generateStructuredResponse: async () =>
        JSON.stringify({
          skills: ["pallet jack"],
          experience: [],
          credentials: [],
          jobKeywords: ["Production Associate"],
        }),
    }),
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: { withUsageLogging: (provider: unknown) => provider },
});

let createTailoredApplication: typeof import("./tailor-application").createTailoredApplication;
let GroundingViolationError: typeof import("./tailor-application").GroundingViolationError;

before(async () => {
  const mod = await import("./tailor-application");
  createTailoredApplication = mod.createTailoredApplication;
  GroundingViolationError = mod.GroundingViolationError;
});

function source(id: string) {
  return {
    job: {
      id,
      title: "Production Associate",
      company: "Beckley Components",
      location: "Beckley, WV",
      description: "Second shift line work.",
      salary: null,
      clusters: ["manufacturing"],
    },
    profile: {
      resume: {
        contact: { name: "Dana Whitaker", email: "", phone: "", location: "" },
        summary: "",
        skills: ["pallet jack"],
        experience: [],
        education: [],
        certifications: [],
      },
      completedCertifications: [],
      nationalClusters: null,
      transferableSkills: null,
    },
    grounding: "JOB POSTING\nTitle: Production Associate",
  } as unknown as import("./tailor-application").TailoringSource;
}

beforeEach(() => {
  resumeCreates.length = 0;
  letterCreates.length = 0;
  versionScans.length = 0;
});

describe("createTailoredApplication — the opening it writes", () => {
  it('a "lead" target sets jobLeadId and NULLS jobListingId', async () => {
    await createTailoredApplication("stu1", { kind: "lead", id: "lead1" }, source("lead1"));

    for (const data of [resumeCreates[0], letterCreates[0]]) {
      assert.equal(data.jobLeadId, "lead1");
      assert.equal(
        data.jobListingId,
        null,
        "a lead id was written into the JobListing column — the FK rejects that",
      );
    }
  });

  it('a "listing" target sets jobListingId and NULLS jobLeadId', async () => {
    await createTailoredApplication(
      "stu1",
      { kind: "listing", id: "listing1" },
      source("listing1"),
    );

    for (const data of [resumeCreates[0], letterCreates[0]]) {
      assert.equal(data.jobListingId, "listing1");
      assert.equal(data.jobLeadId, null);
    }
  });

  it("scans versions on the SAME column it writes", async () => {
    // Otherwise a lead's first résumé takes its version number from some
    // unrelated listing's history, and the two @@unique(studentId, <key>,
    // version) pairs start disagreeing about what "version 2" means.
    await createTailoredApplication("stu1", { kind: "lead", id: "lead1" }, source("lead1"));

    assert.deepEqual(versionScans[0], { studentId: "stu1", jobLeadId: "lead1" });
  });

  it("refuses when the gathered job is not the one that was asked for", async () => {
    await assert.rejects(
      () => createTailoredApplication("stu1", { kind: "lead", id: "lead1" }, source("other")),
      GroundingViolationError,
    );
    assert.equal(resumeCreates.length, 0);
  });
});
