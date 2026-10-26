import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_CERT_TYPE,
  matchingCatalogEntries,
  planCertTypeBackfill,
  tallyCertTypeBackfillPlan,
} from "./cert-type-backfill-planner.mjs";

const CATALOG = [
  { id: "ic3", name: "IC3 Digital Literacy", shortName: "IC3" },
  { id: "mos-word", name: "Microsoft Office Specialist - Word", shortName: "MOS Word" },
  { id: "workkeys-ncrc", name: "ACT WorkKeys NCRC", shortName: "WorkKeys" },
];

describe("planCertTypeBackfill", () => {
  it("plans a backfill when a legacy row's name matches exactly one catalog entry", () => {
    const rows = [{ id: "cert-1", certType: LEGACY_CERT_TYPE, name: "ACT WorkKeys NCRC", issuer: null }];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, [{ id: "cert-1", from: "ready-to-work", to: "workkeys-ncrc" }]);
    assert.deepEqual(plan.skipped, []);
  });

  it("matches case-insensitively and against shortName too", () => {
    const rows = [{ id: "cert-2", certType: LEGACY_CERT_TYPE, name: "workkeys", issuer: null }];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, [{ id: "cert-2", from: "ready-to-work", to: "workkeys-ncrc" }]);
  });

  it("leaves a row alone when its name is ambiguous across the catalog", () => {
    const ambiguousCatalog = [
      ...CATALOG,
      { id: "mos-word-2016", name: "Microsoft Office Specialist - Word", shortName: "MOS 2016 Word" },
    ];
    const rows = [
      { id: "cert-3", certType: LEGACY_CERT_TYPE, name: "Microsoft Office Specialist - Word", issuer: null },
    ];

    const plan = planCertTypeBackfill(rows, ambiguousCatalog);

    assert.deepEqual(plan.planned, []);
    assert.deepEqual(plan.skipped, [{ id: "cert-3", from: "ready-to-work", reason: "ambiguous" }]);
  });

  it("leaves a row alone when it has no name to match at all — today's real shape", () => {
    // The Certification table has no name/issuer column, so every row a real
    // run of the script points at looks exactly like this: name and issuer
    // both null. This is the case that proves "leaves the rest" for the
    // data VisionQuest actually has today.
    const rows = [{ id: "cert-4", certType: LEGACY_CERT_TYPE, name: null, issuer: null }];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, []);
    assert.deepEqual(plan.skipped, [{ id: "cert-4", from: "ready-to-work", reason: "no_name" }]);
  });

  it("leaves a row alone when its name matches no catalog entry", () => {
    const rows = [{ id: "cert-5", certType: LEGACY_CERT_TYPE, name: "Some Unrelated Credential", issuer: null }];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, []);
    assert.deepEqual(plan.skipped, [{ id: "cert-5", from: "ready-to-work", reason: "no_match" }]);
  });

  it("does not touch a row whose certType is already something other than the legacy default", () => {
    const rows = [{ id: "cert-6", certType: "workkeys-ncrc", name: "ACT WorkKeys NCRC", issuer: null }];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, []);
    assert.deepEqual(plan.skipped, []);
  });

  it("plans each eligible row independently in one pass", () => {
    const rows = [
      { id: "cert-7", certType: LEGACY_CERT_TYPE, name: "IC3 Digital Literacy", issuer: null },
      { id: "cert-8", certType: LEGACY_CERT_TYPE, name: null, issuer: null },
      { id: "cert-9", certType: LEGACY_CERT_TYPE, name: "Nothing Like This", issuer: null },
    ];

    const plan = planCertTypeBackfill(rows, CATALOG);

    assert.deepEqual(plan.planned, [{ id: "cert-7", from: "ready-to-work", to: "ic3" }]);
    assert.equal(plan.skipped.length, 2);
    assert.deepEqual(tallyCertTypeBackfillPlan(plan), { planned: 1, no_name: 1, no_match: 1, ambiguous: 0 });
  });
});

describe("matchingCatalogEntries", () => {
  it("returns every entry matching a candidate name, exactly and case-insensitively", () => {
    assert.deepEqual(matchingCatalogEntries("ic3 digital literacy", CATALOG), [CATALOG[0]]);
    assert.deepEqual(matchingCatalogEntries("no such credential", CATALOG), []);
  });

  it("never does a substring match", () => {
    // "Word" is a substring of "Microsoft Office Specialist - Word" but must
    // not match it — substring matching is exactly the ambiguity hazard this
    // planner exists to avoid.
    assert.deepEqual(matchingCatalogEntries("Word", CATALOG), []);
  });
});
