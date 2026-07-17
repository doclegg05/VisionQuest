import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupJobsByBand } from "./job-band-groups";
import type { JobBand } from "./job-bands-response";

interface TestJob {
  id: string;
  band?: JobBand | null;
}

const job = (id: string, band?: JobBand | null): TestJob => ({ id, band });

describe("groupJobsByBand", () => {
  it("partitions into Core/Stretch/Wildcard/Other in that fixed order with correct counts", () => {
    const jobs = [
      job("a", "core"),
      job("b", "stretch"),
      job("c", "wildcard"),
      job("d", null),
      job("e", "core"),
    ];

    const sections = groupJobsByBand(jobs);

    assert.deepEqual(
      sections.map((s) => s.key),
      ["core", "stretch", "wildcard", "other"],
    );
    assert.deepEqual(
      sections.map((s) => s.count),
      [2, 1, 1, 1],
    );
    // every section carries a plain-language label + explainer
    for (const section of sections) {
      assert.ok(section.label && section.explainer);
    }
  });

  it("routes band:null (and undefined) jobs into Other when some jobs are banded", () => {
    const jobs = [job("a", "core"), job("b", null), job("c")];
    const other = groupJobsByBand(jobs).find((s) => s.key === "other");
    assert.ok(other);
    assert.deepEqual(
      other.jobs.map((j) => j.id),
      ["b", "c"],
    );
  });

  it("preserves input order within each section", () => {
    const jobs = [job("a", "core"), job("b", "stretch"), job("c", "core")];
    const core = groupJobsByBand(jobs).find((s) => s.key === "core");
    assert.deepEqual(core?.jobs.map((j) => j.id), ["a", "c"]);
  });

  it("returns ONE ungrouped section preserving order when no job has a band", () => {
    const jobs = [job("a", null), job("b"), job("c", null)];
    const sections = groupJobsByBand(jobs);

    assert.equal(sections.length, 1);
    assert.equal(sections[0].key, "ungrouped");
    assert.equal(sections[0].label, null);
    assert.equal(sections[0].explainer, null);
    assert.deepEqual(sections[0].jobs.map((j) => j.id), ["a", "b", "c"]);
    assert.equal(sections[0].count, 3);
  });

  it("assigns every input job to exactly one section (total, no drops or duplicates)", () => {
    const jobs = [
      job("a", "core"),
      job("b", "stretch"),
      job("c", "wildcard"),
      job("d", null),
      job("e", "wildcard"),
      job("f", "core"),
    ];

    const sections = groupJobsByBand(jobs);
    const placed = sections.flatMap((s) => s.jobs.map((j) => j.id));

    assert.equal(placed.length, jobs.length, "no drops or duplicates");
    assert.deepEqual([...placed].sort(), jobs.map((j) => j.id).sort());
  });

  it("returns an empty ungrouped section for an empty input", () => {
    const sections = groupJobsByBand([]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].key, "ungrouped");
    assert.equal(sections[0].count, 0);
  });
});
