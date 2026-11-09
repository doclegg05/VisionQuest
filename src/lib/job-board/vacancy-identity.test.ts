import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VACANCY_KEY_VERSION,
  excludeHiddenVacancies,
  vacancyKeyFor,
  vacancySnapshotFor,
} from "./vacancy-identity";
import { dedupeJobsForDisplay, jobDuplicateKey } from "./duplicates";

const lookAlikeA = {
  id: "row-a",
  title: "Cashier",
  company: "Kroger",
  location: "Charleston, WV",
  workMode: "onsite",
  source: "adzuna",
  sourceId: "adzuna:111",
  url: "https://example.com/a",
  updatedAt: new Date("2026-11-01T00:00:00Z"),
};
const lookAlikeB = { ...lookAlikeA, id: "row-b", sourceId: "adzuna:222", url: "https://example.com/b" };

describe("vacancyKeyFor", () => {
  it("builds a versioned key from source and source id", () => {
    assert.equal(VACANCY_KEY_VERSION, "v1");
    assert.equal(vacancyKeyFor({ source: "adzuna", sourceId: "adzuna:111" }), "v1:adzuna:adzuna:111");
  });

  it("lowercases and trims the source but keeps the source id's case", () => {
    assert.equal(
      vacancyKeyFor({ source: "  Greenhouse ", sourceId: " greenhouse:Acme:AbC9 " }),
      "v1:greenhouse:greenhouse:Acme:AbC9",
    );
  });

  it("gives a class row and a browse row for the same posting the same key", () => {
    const classRow = { classConfigId: "config-1", source: "remotive", sourceId: "remotive:9" };
    const otherClassRow = { classConfigId: "config-2", source: "remotive", sourceId: "remotive:9" };
    const browseRow = { source: "remotive", sourceId: "remotive:9" };
    assert.equal(vacancyKeyFor(classRow), vacancyKeyFor(browseRow));
    assert.equal(vacancyKeyFor(classRow), vacancyKeyFor(otherClassRow));
  });

  it("keeps two openings apart that the display key merges", () => {
    assert.equal(jobDuplicateKey(lookAlikeA), jobDuplicateKey(lookAlikeB));
    assert.notEqual(vacancyKeyFor(lookAlikeA), vacancyKeyFor(lookAlikeB));
  });

  it("returns null when either part is blank", () => {
    assert.equal(vacancyKeyFor({ source: "", sourceId: "x" }), null);
    assert.equal(vacancyKeyFor({ source: "adzuna", sourceId: "   " }), null);
  });
});

describe("excludeHiddenVacancies", () => {
  it("drops the hidden vacancy and keeps a distinct requisition that looks the same", () => {
    const hidden = new Set([vacancyKeyFor(lookAlikeA) as string]);
    const visible = excludeHiddenVacancies([lookAlikeA, lookAlikeB], hidden);
    assert.deepEqual(visible.map((row) => row.id), ["row-b"]);
  });

  it("filters before display grouping, so the other look-alike still shows", () => {
    const hidden = new Set([vacancyKeyFor(lookAlikeB) as string]);
    const shown = dedupeJobsForDisplay(excludeHiddenVacancies([lookAlikeA, lookAlikeB], hidden));
    assert.deepEqual(shown.map((row) => row.id), ["row-a"]);
  });

  it("returns every row when nothing is hidden and does not change the input", () => {
    const rows = [lookAlikeA, lookAlikeB];
    const result = excludeHiddenVacancies(rows, new Set());
    assert.deepEqual(result.map((row) => row.id), ["row-a", "row-b"]);
    assert.notEqual(result, rows);
    assert.equal(rows.length, 2);
  });
});

describe("vacancySnapshotFor", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("copies only the posting's public facts", () => {
    const listing = {
      ...lookAlikeA,
      description: "Long text that is not kept",
      salary: "$12/hr",
      postedAt: new Date("2026-11-02T00:00:00Z"),
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    };
    assert.deepEqual(vacancySnapshotFor(listing, now), {
      snapshotTitle: "Cashier",
      snapshotCompany: "Kroger",
      snapshotLocation: "Charleston, WV",
      snapshotUrl: "https://example.com/a",
      snapshotSource: "adzuna",
      snapshotSourceId: "adzuna:111",
      snapshotPostedAt: new Date("2026-11-02T00:00:00Z"),
      snapshotExpiresAt: new Date("2026-12-01T00:00:00Z"),
      snapshotAt: now,
    });
  });

  it("stores null dates for a class row with no posted date", () => {
    const snapshot = vacancySnapshotFor({ ...lookAlikeA, expiresAt: null }, now);
    assert.equal(snapshot.snapshotPostedAt, null);
    assert.equal(snapshot.snapshotExpiresAt, null);
  });
});
