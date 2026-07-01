import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findNoteDrift } from "./drift-audit";
import type { CatalogNode } from "./schema";

function n(over = {}, sections = {}) {
  return {
    frontmatter: { type:"program_document", title:"T", description:"RTW.", resource:"r", tags:[], timestamp:"2026-06-30",
      vq_id:"rtw", vq_audience:"BOTH", vq_category:"READY_TO_WORK", vq_storage_key:"rtw/RTW.pdf", vq_status:"approved", ...over },
    sections: { whenToUse:"Use at completion.", whenNotToUse:"", related:"", ...sections },
    body:"", filePath:"x.md",
  } as CatalogNode;
}

describe("findNoteDrift", () => {
  it("flags when the DB note differs from the catalog-derived note", () => {
    const f = findNoteDrift([n()], [{ id:"d1", storageKey:"rtw/RTW.pdf", sageContextNote:"stale text" }]);
    assert.equal(f.length, 1);
    assert.equal(f[0].storageKey, "rtw/RTW.pdf");
  });
  it("is silent when they match", () => {
    const f = findNoteDrift([n()], [{ id:"d1", storageKey:"rtw/RTW.pdf", sageContextNote:"RTW. Use at completion." }]);
    assert.deepEqual(f, []);
  });
});
