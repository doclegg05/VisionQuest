import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSavedLookup, savedMetaFor, toInteractionInputs, type SavedLookupRow } from "./saved-job-lookup";

function row(overrides: Partial<SavedLookupRow>): SavedLookupRow {
  return {
    jobListingId: null,
    jobBrowseListingId: null,
    vacancyKey: null,
    status: "saved",
    notes: null,
    appliedAt: null,
    snapshotCompany: null,
    snapshotSource: null,
    jobListing: null,
    jobBrowseListing: null,
    ...overrides,
  };
}

describe("saved job lookup", () => {
  it("matches a reimported row by vacancy key", () => {
    const lookup = buildSavedLookup([row({ vacancyKey: "v1:adzuna:adzuna:1", status: "applied", appliedAt: new Date("2026-11-01T00:00:00Z") })]);
    assert.deepEqual(savedMetaFor(lookup, { id: "new-row", source: "Adzuna", sourceId: "adzuna:1" }), {
      savedStatus: "applied",
      savedNotes: null,
      savedAppliedAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("falls back to the listing id for a legacy row with no key", () => {
    const lookup = buildSavedLookup([row({ jobListingId: "job-1", notes: "Call back" })]);
    assert.equal(savedMetaFor(lookup, { id: "job-1", source: "adzuna", sourceId: "adzuna:9" }).savedNotes, "Call back");
  });

  it("matches a browse save by its browse listing id", () => {
    const lookup = buildSavedLookup([row({ jobBrowseListingId: "browse-1" })]);
    assert.equal(savedMetaFor(lookup, { id: "browse-1", source: "remotive", sourceId: "r:1" }).savedStatus, "saved");
  });

  it("returns empty meta when nothing matches", () => {
    assert.deepEqual(savedMetaFor(buildSavedLookup([]), { id: "x", source: "a", sourceId: "b" }), {
      savedStatus: null,
      savedNotes: null,
      savedAppliedAt: null,
    });
  });

  it("feeds the ranker from the live listing, else the snapshot", () => {
    const inputs = toInteractionInputs([
      row({ status: "applied", jobListing: { clusters: ["healthcare"], company: "Valley", source: "adzuna" } }),
      row({ status: "withdrawn", snapshotCompany: "Gone Co", snapshotSource: "usajobs" }),
    ]);
    assert.deepEqual(inputs, [
      { status: "applied", jobListing: { clusters: ["healthcare"], company: "Valley", source: "adzuna" } },
      { status: "withdrawn", jobListing: { clusters: [], company: "Gone Co", source: "usajobs" } },
    ]);
  });
});
