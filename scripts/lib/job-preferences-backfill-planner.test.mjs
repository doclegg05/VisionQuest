import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planJobPreferencesBackfill } from "./job-preferences-backfill-planner.mjs";
import { vacancyKeyFor, vacancySnapshotFor } from "../../src/lib/job-board/vacancy-identity.ts";

const now = new Date("2026-11-10T00:00:00Z");
const deps = { keyFor: vacancyKeyFor, snapshotFor: vacancySnapshotFor, now };

function listing(sourceId) {
  return {
    title: "Cashier",
    company: "Kroger",
    location: "Charleston, WV",
    url: "https://example.com/a",
    source: "adzuna",
    sourceId,
    expiresAt: null,
  };
}

function row(id, studentId, sourceId, updatedAt) {
  return { id, studentId, updatedAt: new Date(updatedAt), jobListing: sourceId ? listing(sourceId) : null };
}

describe("planJobPreferencesBackfill", () => {
  it("keys each row with its vacancy and snapshot", () => {
    const plan = planJobPreferencesBackfill([row("s1", "stu-1", "adzuna:1", "2026-11-01")], new Set(), deps);
    assert.equal(plan.planned.length, 1);
    assert.equal(plan.planned[0].id, "s1");
    assert.equal(plan.planned[0].data.vacancyKey, "v1:adzuna:adzuna:1");
    assert.equal(plan.planned[0].data.listingKind, "class");
    assert.equal(plan.planned[0].data.snapshotTitle, "Cashier");
    assert.deepEqual(plan.planned[0].data.snapshotAt, now);
  });

  it("keys only the newest of one student's saves for the same vacancy", () => {
    const plan = planJobPreferencesBackfill(
      [row("old", "stu-1", "adzuna:1", "2026-10-01"), row("new", "stu-1", "adzuna:1", "2026-11-01")],
      new Set(),
      deps,
    );
    assert.deepEqual(plan.planned.map((p) => p.id), ["new"]);
    assert.equal(plan.collisions, 1);
  });

  it("treats two students' saves of one vacancy separately", () => {
    const plan = planJobPreferencesBackfill(
      [row("a", "stu-1", "adzuna:1", "2026-11-01"), row("b", "stu-2", "adzuna:1", "2026-11-01")],
      new Set(),
      deps,
    );
    assert.equal(plan.planned.length, 2);
    assert.equal(plan.collisions, 0);
  });

  it("leaves a row alone when the student already has a keyed row for it", () => {
    const plan = planJobPreferencesBackfill(
      [row("legacy", "stu-1", "adzuna:1", "2026-11-01")],
      new Set(["stu-1\u0000v1:adzuna:adzuna:1"]),
      deps,
    );
    assert.equal(plan.planned.length, 0);
    assert.equal(plan.collisions, 1);
  });

  it("counts rows with no listing or no usable key", () => {
    const plan = planJobPreferencesBackfill(
      [row("gone", "stu-1", null, "2026-11-01"), row("blank", "stu-1", "  ", "2026-11-01")],
      new Set(),
      deps,
    );
    assert.deepEqual({ planned: plan.planned.length, noListing: plan.noListing, noKey: plan.noKey }, {
      planned: 0,
      noListing: 1,
      noKey: 1,
    });
  });

  it("plans nothing on a second run, since keyed rows are not read again", () => {
    assert.equal(planJobPreferencesBackfill([], new Set(), deps).planned.length, 0);
  });
});
