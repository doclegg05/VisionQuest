/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-017 — application tracking is unified on the Application model (locked
// tracker decision). trackJobInterest is the single student write path:
// resolve the source listing (class JobListing or browse JobBrowseListing),
// find-or-create an Opportunity deduped by url, upsert the Application keyed
// on (studentId, opportunityId), stamp appliedAt once on first applied-family
// status, and record every student-driven change as self_reported (P1-4).
// StudentSavedJob is never written — it stopped being the pipeline.
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockJobListingFindUnique = mock.fn(async () => null) as any;
const mockBrowseListingFindUnique = mock.fn(async () => null) as any;
const mockOpportunityFindFirst = mock.fn(async () => null) as any;
const mockOpportunityCreate = mock.fn(async () => ({})) as any;
const mockApplicationFindUnique = mock.fn(async () => null) as any;
const mockApplicationUpsert = mock.fn(async () => ({ id: "app-1" })) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobListing: {
        get findUnique() {
          return mockJobListingFindUnique;
        },
      },
      jobBrowseListing: {
        get findUnique() {
          return mockBrowseListingFindUnique;
        },
      },
      opportunity: {
        get findFirst() {
          return mockOpportunityFindFirst;
        },
        get create() {
          return mockOpportunityCreate;
        },
      },
      application: {
        get findUnique() {
          return mockApplicationFindUnique;
        },
        get upsert() {
          return mockApplicationUpsert;
        },
      },
    },
  },
});

let lib: typeof import("./job-applications");

before(async () => {
  lib = await import("./job-applications");
});

const STUDENT_ID = "stu-1";

function listingFixture(overrides: Record<string, unknown> = {}) {
  return {
    title: "Office Assistant",
    company: "Acme",
    location: "Charleston, WV",
    url: "https://example.com/jobs/1",
    description: "Answer phones and keep records updated.",
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of [
    mockJobListingFindUnique,
    mockBrowseListingFindUnique,
    mockOpportunityFindFirst,
    mockOpportunityCreate,
    mockApplicationFindUnique,
    mockApplicationUpsert,
  ]) {
    m.mock.resetCalls();
  }
  mockJobListingFindUnique.mock.mockImplementation(async () => listingFixture());
  mockBrowseListingFindUnique.mock.mockImplementation(async () => null);
  mockOpportunityFindFirst.mock.mockImplementation(async () => null);
  mockOpportunityCreate.mock.mockImplementation(async () => ({
    id: "opp-created",
    title: "Office Assistant",
    company: "Acme",
  }));
  mockApplicationFindUnique.mock.mockImplementation(async () => null);
  mockApplicationUpsert.mock.mockImplementation(async (args: any) => ({
    id: "app-1",
    ...args.create,
  }));
});

describe("trackJobInterest (VQ-R-017)", () => {
  it("creates an Opportunity from the listing when no url match exists", async () => {
    const result = await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
    });

    assert.equal(result.ok, true);
    assert.equal(mockOpportunityCreate.mock.callCount(), 1);
    const createArgs = mockOpportunityCreate.mock.calls[0].arguments[0];
    assert.equal(createArgs.data.type, "job");
    assert.equal(createArgs.data.title, "Office Assistant");
    assert.equal(createArgs.data.company, "Acme");
    assert.equal(createArgs.data.url, "https://example.com/jobs/1");
    assert.equal(createArgs.data.createdById, STUDENT_ID);
  });

  it("dedupes on Opportunity url — reuses the existing row, creates nothing", async () => {
    mockOpportunityFindFirst.mock.mockImplementation(async () => ({
      id: "opp-existing",
      title: "Office Assistant",
      company: "Acme",
    }));

    const result = await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
    });

    assert.equal(result.ok, true);
    assert.equal(mockOpportunityCreate.mock.callCount(), 0);
    const findArgs = mockOpportunityFindFirst.mock.calls[0].arguments[0];
    assert.deepEqual(findArgs.where, { url: "https://example.com/jobs/1" });
    const upsertArgs = mockApplicationUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(upsertArgs.where, {
      studentId_opportunityId: { studentId: STUDENT_ID, opportunityId: "opp-existing" },
    });
  });

  it("resolves a browse source from JobBrowseListing", async () => {
    mockJobListingFindUnique.mock.mockImplementation(async () => null);
    mockBrowseListingFindUnique.mock.mockImplementation(async () =>
      listingFixture({ url: "https://example.com/browse/9" }),
    );

    const result = await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "browse", browseListingId: "browse-9" },
    });

    assert.equal(result.ok, true);
    assert.equal(mockJobListingFindUnique.mock.callCount(), 0);
    assert.equal(mockBrowseListingFindUnique.mock.callCount(), 1);
    const createArgs = mockOpportunityCreate.mock.calls[0].arguments[0];
    assert.equal(createArgs.data.url, "https://example.com/browse/9");
  });

  it("reports listing_not_found when the source row does not exist", async () => {
    mockJobListingFindUnique.mock.mockImplementation(async () => null);

    const result = await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "missing" },
    });

    assert.deepEqual(result, { ok: false, reason: "listing_not_found" });
    assert.equal(mockApplicationUpsert.mock.callCount(), 0);
  });

  it("defaults a new row to saved + self_reported with no appliedAt", async () => {
    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
    });

    const { create } = mockApplicationUpsert.mock.calls[0].arguments[0];
    assert.equal(create.status, "saved");
    assert.equal(create.appliedAt, null);
    assert.equal(create.verificationStatus, "self_reported");
  });

  it("stamps appliedAt once — first applied-family status sets it, later changes keep it", async () => {
    // First: row exists without appliedAt, student reports "applied".
    mockApplicationFindUnique.mock.mockImplementation(async () => ({ appliedAt: null }));
    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
      status: "applied",
    });
    const firstUpdate = mockApplicationUpsert.mock.calls[0].arguments[0].update;
    assert.ok(firstUpdate.appliedAt instanceof Date);

    // Later: appliedAt already stamped, moving to "interviewing" must not restamp.
    mockApplicationFindUnique.mock.mockImplementation(async () => ({
      appliedAt: new Date("2026-07-01T00:00:00Z"),
    }));
    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
      status: "interviewing",
    });
    const secondUpdate = mockApplicationUpsert.mock.calls[1].arguments[0].update;
    assert.equal(secondUpdate.appliedAt, undefined);
  });

  it("stores the Application-model vocabulary: offered -> offer", async () => {
    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
      status: "offered",
    });

    const args = mockApplicationUpsert.mock.calls[0].arguments[0];
    assert.equal(args.create.status, "offer");
    assert.equal(args.update.status, "offer");
  });

  it("stamps status changes self_reported and clears the instructor sign-off (P1-4)", async () => {
    mockApplicationFindUnique.mock.mockImplementation(async () => ({ appliedAt: null }));

    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
      status: "applied",
      notes: "Submitted online",
    });

    const { update } = mockApplicationUpsert.mock.calls[0].arguments[0];
    assert.equal(update.verificationStatus, "self_reported");
    assert.equal(update.verifiedBy, null);
    assert.equal(update.verifiedAt, null);
    assert.equal(update.notes, "Submitted online");
  });

  it("a bare re-save (no status, no notes) leaves the existing row untouched", async () => {
    mockApplicationFindUnique.mock.mockImplementation(async () => ({
      appliedAt: new Date("2026-07-01T00:00:00Z"),
    }));

    await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
    });

    // No claim was made — a no-op touch must not clear an instructor's
    // verification of the existing outcome.
    const { update } = mockApplicationUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(update, {});
  });

  it("never writes StudentSavedJob", async () => {
    // The db mock exposes no studentSavedJob delegate at all — any attempt to
    // touch it would throw. Completing successfully is the proof.
    const result = await lib.trackJobInterest({
      studentId: STUDENT_ID,
      source: { kind: "listing", jobListingId: "job-1" },
      status: "applied",
    });
    assert.equal(result.ok, true);
  });
});

describe("applicationStatusForJobBoard (VQ-R-017)", () => {
  it("maps the Application vocabulary onto the job-board vocabulary", () => {
    assert.equal(lib.applicationStatusForJobBoard("saved"), "saved");
    assert.equal(lib.applicationStatusForJobBoard("applied"), "applied");
    assert.equal(lib.applicationStatusForJobBoard("interviewing"), "interviewing");
    assert.equal(lib.applicationStatusForJobBoard("offer"), "offered");
    assert.equal(lib.applicationStatusForJobBoard("accepted"), "offered");
    assert.equal(lib.applicationStatusForJobBoard("withdrawn"), "withdrawn");
    // OpportunitiesHub-only statuses fall back to the nearest board state.
    assert.equal(lib.applicationStatusForJobBoard("rejected"), "applied");
    assert.equal(lib.applicationStatusForJobBoard("unknown-status"), "saved");
  });
});
