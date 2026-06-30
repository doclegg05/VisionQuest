import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFormRoutingOverlay, buildDocNote, buildDocSyncManifest } from "./sync";
import type { CatalogNode } from "./schema";

function n(over = {}, sections = {}) {
  return {
    frontmatter: { type:"form", title:"T", description:"d", resource:"r", tags:["a"], timestamp:"2026-06-30",
      vq_id:"attendance-contract", vq_audience:"STUDENT", vq_category:"onboarding", vq_status:"approved", ...over },
    sections: { whenToUse:"Use it weekly.", whenNotToUse:"Not for X.", related:"", ...sections },
    body:"", filePath:"x.md",
  } as CatalogNode;
}

describe("buildFormRoutingOverlay", () => {
  it("keys approved form entries by formId with note+tags", () => {
    const o = buildFormRoutingOverlay([n({ vq_id:"attendance-contract", tags:["attendance"] })]);
    assert.equal(o.version, 1);
    assert.equal(o.entries["attendance-contract"].tags[0], "attendance");
    assert.match(o.entries["attendance-contract"].whenToUse, /weekly/);
  });
  it("ignores non-form or non-approved nodes", () => {
    const o = buildFormRoutingOverlay([n({ type:"program_document" }), n({ vq_status:"draft" })]);
    assert.deepEqual(Object.keys(o.entries), []);
  });
});

describe("buildDocNote", () => {
  it("combines description + when-to-use + when-not", () => {
    const note = buildDocNote(n({ description:"RTW." }));
    assert.match(note, /RTW\./); assert.match(note, /Use it weekly/); assert.match(note, /Not for X/);
  });
});

describe("buildDocSyncManifest (dual-sink)", () => {
  it("includes a FORM node whose storageKey matches a ProgramDocument", () => {
    const node = n({ vq_storage_key:"orientation/AC.pdf" });
    const m = buildDocSyncManifest([node], new Map([["orientation/AC.pdf", { id:"doc_1" }]]));
    assert.equal(m.length, 1); assert.equal(m[0].docId, "doc_1");
  });
  it("skips a node whose storageKey has no matching ProgramDocument", () => {
    assert.deepEqual(buildDocSyncManifest([n({ vq_storage_key:"forms/registry-only.pdf" })], new Map()), []);
  });
  it("skips a node with no storageKey", () => {
    assert.deepEqual(buildDocSyncManifest([n({ vq_storage_key: undefined })], new Map()), []);
  });
});
