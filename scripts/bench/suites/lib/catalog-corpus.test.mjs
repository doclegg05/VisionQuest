import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expectedGroundingStorageKeys,
  loadCatalogCorpusRows,
  mapCategory,
  missingStorageKeys,
} from "../../lib/catalog-corpus.mjs";

const { tokenizeForRetrieval } = await import("../../../../src/lib/sage/retrieval-tokens.ts");

/** Mirrors scoreDocument() title+note weights in knowledge-base-server.ts. */
function keywordScore(row, message) {
  const messageLower = message.toLowerCase();
  let score = 0;
  for (const word of tokenizeForRetrieval(row.title, 3)) {
    if (messageLower.includes(word)) score += word.length;
  }
  if (row.sageContextNote) {
    for (const word of tokenizeForRetrieval(row.sageContextNote.slice(0, 500), 4)) {
      if (messageLower.includes(word)) score += 1;
    }
  }
  return score;
}

const GROUNDING_KEYS = [
  "orientation/SPOKES_Dress_Code_Policy_FY26_Fillable.pdf",
  "orientation/SPOKES_Rights_and_Responsibilities_FY26_Fillable.pdf",
  "orientation/SPOKES Checklist for Student Orientation.pdf",
];

test("expectedGroundingStorageKeys reads the three fixture citation ids", () => {
  const keys = expectedGroundingStorageKeys();
  assert.deepEqual(keys.sort(), [...GROUNDING_KEYS].sort());
});

test("loadCatalogCorpusRows includes every grounding fixture storage key", () => {
  const rows = loadCatalogCorpusRows();
  assert.equal(missingStorageKeys(rows, GROUNDING_KEYS).length, 0);
  const byKey = new Map(rows.map((row) => [row.storageKey, row]));
  assert.match(byKey.get(GROUNDING_KEYS[0]).title, /dress code/i);
  assert.match(byKey.get(GROUNDING_KEYS[1]).title, /rights/i);
  assert.match(byKey.get(GROUNDING_KEYS[2]).title, /orientation/i);
  for (const key of GROUNDING_KEYS) {
    assert.ok(byKey.get(key).sageContextNote.length > 0);
    assert.equal(byKey.get(key).audience, "STUDENT");
  }
});

test("loadCatalogCorpusRows merges catalog nodes that share a storage key", () => {
  const rows = loadCatalogCorpusRows();
  const shared = rows.find(
    (row) => row.storageKey === "orientation/Employment_Portfolio_Checklist_FY26_Fillable.pdf",
  );
  assert.ok(shared, "shared portfolio checklist PDF should produce one row");
  assert.ok(shared.vqIds.includes("portfolio-checklist"));
  assert.ok(shared.vqIds.includes("portfolio-checklist-tracking"));
  assert.match(shared.sageContextNote, /—/);
});

test("mapCategory: enum members pass through; catalog aliases land on a ProgramDocCategory", () => {
  assert.equal(mapCategory("ORIENTATION", "orientation/x.pdf"), "ORIENTATION");
  assert.equal(mapCategory("onboarding", "orientation/x.pdf"), "ORIENTATION");
  assert.equal(mapCategory("dohs", "forms/x.pdf"), "DOHS_FORM");
  assert.equal(mapCategory("mystery", "lms/Aztec/x.pdf"), "LMS_PLATFORM_GUIDE");
  assert.equal(mapCategory("mystery", "unknown/x.pdf"), "STUDENT_RESOURCE");
});

test("missingStorageKeys names only the absent ones", () => {
  const rows = [{ storageKey: GROUNDING_KEYS[0] }];
  assert.deepEqual(missingStorageKeys(rows, GROUNDING_KEYS), GROUNDING_KEYS.slice(1));
});

test("keyword scoring of the catalog corpus ranks each grounding fixture's expected doc in the top 3", () => {
  const studentRows = loadCatalogCorpusRows().filter((row) => row.audience !== "TEACHER");
  const cases = [
    { message: "What is the SPOKES dress code?", expected: GROUNDING_KEYS[0], pool: studentRows },
    {
      message: "Where can I find my SPOKES rights and responsibilities?",
      expected: GROUNDING_KEYS[1],
      pool: studentRows,
    },
    {
      message: "What forms does a new student need to complete for orientation?",
      expected: GROUNDING_KEYS[2],
      pool: loadCatalogCorpusRows(),
    },
  ];
  for (const testCase of cases) {
    const ranked = [...testCase.pool].sort(
      (a, b) => keywordScore(b, testCase.message) - keywordScore(a, testCase.message),
    );
    const top3 = ranked.slice(0, 3).map((row) => row.storageKey);
    assert.ok(
      top3.includes(testCase.expected),
      `${testCase.expected} not in top 3 for "${testCase.message}" (got ${top3.join(", ")})`,
    );
  }
});
