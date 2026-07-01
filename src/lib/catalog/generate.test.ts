import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapFormAudience, buildFormNodeMarkdown, buildProgramDocNodeMarkdown, slugifyStorageKey } from "./generate";
import { parseCatalogNode } from "./parse";

const FORM = { id:"dfa-ts-12", title:"DFA-TS-12 Timesheet", description:"Weekly participant timesheet.", category:"dohs", fileName:"DFA-TS-12.pdf", storageKey:"forms/DFA-TS-12.pdf", fillable:true, required:true, audience:"both", acceptsSubmission:true, requiresSignature:true, sortOrder:10 } as const;

describe("generate forms", () => {
  it("maps audience to uppercase", () => { assert.equal(mapFormAudience("instructor"),"TEACHER"); assert.equal(mapFormAudience("both"),"BOTH"); });
  it("emits a draft form node with derived hard identity + empty soft sections", () => {
    const n = parseCatalogNode(buildFormNodeMarkdown(FORM), "x.md");
    assert.equal(n.frontmatter.type, "form");
    assert.equal(n.frontmatter.vq_id, "dfa-ts-12");
    assert.equal(n.frontmatter.vq_storage_key, "forms/DFA-TS-12.pdf");
    assert.equal(n.frontmatter.vq_status, "draft");
    assert.equal(n.sections.whenToUse, "");
  });
  it("omits vq_storage_key (no undefined dump) when a form has none", () => {
    const noKey = { ...FORM, storageKey: null } as const;
    const n = parseCatalogNode(buildFormNodeMarkdown(noKey), "x.md");
    assert.equal(n.frontmatter.vq_storage_key, undefined);
  });
});

describe("slugifyStorageKey", () => {
  it("slugifies a nested key to its basename", () => {
    assert.equal(slugifyStorageKey("lms/Aztec/Aztec_PLUS_Student_Support_Guide__-_Version_9.0_1.pdf"), "aztec-plus-student-support-guide-version-9-0-1");
  });
});

describe("generate program_document", () => {
  it("emits a draft doc node with DB-derived hard identity", () => {
    const n = parseCatalogNode(buildProgramDocNodeMarkdown({
      title:"Aztec PLUS Student Support Guide", storageKey:"lms/Aztec/Aztec_PLUS_Student_Support_Guide__-_Version_9.0_1.pdf",
      category:"LMS_PLATFORM_GUIDE", audience:"BOTH", certificationId:null, platformId:"aztec",
    }), "x.md");
    assert.equal(n.frontmatter.type, "program_document");
    assert.equal(n.frontmatter.vq_platform, "aztec");
    assert.equal(n.frontmatter.vq_certification, undefined); // null stripped
    assert.equal(n.frontmatter.vq_category, "LMS_PLATFORM_GUIDE");
    assert.equal(n.frontmatter.vq_id, "aztec-plus-student-support-guide-version-9-0-1");
  });
});
