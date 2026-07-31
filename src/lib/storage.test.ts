import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  downloadBundledFile,
  findInContentDir,
  getPresignedDownloadUrl,
  isObjectStorageConfigured,
  mapLocalPathToStorageKey,
} from "./storage";

const BUNDLED_PDF = "orientation/SPOKES_Student_Profile_FY26_Fillable.pdf";
const bundledFileExists = existsSync(
  path.join(process.cwd(), "docs-upload", BUNDLED_PDF),
);

// storageKeys under teachers/guides/ are minted by the uploader's FOLDER_MAP
// (local docs-upload/teachers/ → bucket teachers/guides/), so the bundled
// file lives at a different local path than the key implies.
const REMAPPED_KEY =
  "teachers/guides/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf";
const remappedFileExists = existsSync(
  path.join(
    process.cwd(),
    "docs-upload",
    "teachers/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf",
  ),
);

describe("downloadBundledFile", () => {
  it("loads bundled orientation PDFs from docs-upload", { skip: !bundledFileExists }, async () => {
    const result = await downloadBundledFile(BUNDLED_PDF);

    assert.ok(result);
    assert.equal(result.mimeType, "application/pdf");
    assert.ok(result.buffer.byteLength > 0);
  });

  it("resolves teachers/guides/ keys through the uploader folder map", { skip: !remappedFileExists }, async () => {
    const result = await downloadBundledFile(REMAPPED_KEY);

    assert.ok(result);
    assert.equal(result.mimeType, "application/pdf");
    assert.ok(result.buffer.byteLength > 0);
  });

  it("rejects path traversal attempts", async () => {
    const result = await downloadBundledFile("../package.json");
    assert.equal(result, null);
  });
});

describe("mapLocalPathToStorageKey", () => {
  it("keeps identity-mapped prefixes unchanged", () => {
    assert.equal(mapLocalPathToStorageKey("forms/DFA-TS-12_Rev_-2-24.pdf"), "forms/DFA-TS-12_Rev_-2-24.pdf");
    assert.equal(mapLocalPathToStorageKey("orientation/New Student Welcome Letter.pdf"), "orientation/New Student Welcome Letter.pdf");
    assert.equal(mapLocalPathToStorageKey("lms/Aztec/getting-started.pdf"), "lms/Aztec/getting-started.pdf");
  });

  it("applies the uploader FOLDER_MAP renames", () => {
    assert.equal(
      mapLocalPathToStorageKey("teachers/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf"),
      "teachers/guides/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf",
    );
    assert.equal(mapLocalPathToStorageKey("students/SPOKES Rubric.pdf"), "students/resources/SPOKES Rubric.pdf");
    assert.equal(mapLocalPathToStorageKey("presentation/WVAE-color-contacts.png"), "presentations/WVAE-color-contacts.png");
  });

  it("re-routes Handbook Appendix Section 16 files to lms/certifications/program-info", () => {
    assert.equal(
      mapLocalPathToStorageKey("teachers/Handbook Appendix/Section 16/IC3 Digital Literacy.pdf"),
      "lms/certifications/program-info/IC3 Digital Literacy.pdf",
    );
  });

  it("returns null for unmapped top-level folders and root-level files", () => {
    assert.equal(mapLocalPathToStorageKey("sage-context/notes.md"), null);
    assert.equal(mapLocalPathToStorageKey("_inventory.txt"), null);
  });
});

// Storage backends are selected at module load, so this only asserts the
// unconfigured case — skip when the shell actually has creds exported.
const storageCredsPresent = Boolean(
  (process.env.STORAGE_ENDPOINT && process.env.STORAGE_BUCKET) || process.env.R2_ACCOUNT_ID,
);

describe("isObjectStorageConfigured", () => {
  it("is false when no STORAGE_*/R2_* creds are loaded", { skip: storageCredsPresent }, () => {
    assert.equal(isObjectStorageConfigured(), false);
  });
});

describe("getPresignedDownloadUrl feature-flag gating", () => {
  it("returns null when USE_PRESIGNED_URLS is unset", async () => {
    const prev = process.env.USE_PRESIGNED_URLS;
    delete process.env.USE_PRESIGNED_URLS;
    try {
      const url = await getPresignedDownloadUrl("any-key");
      assert.equal(url, null);
    } finally {
      if (prev !== undefined) process.env.USE_PRESIGNED_URLS = prev;
    }
  });

  it("returns null when USE_PRESIGNED_URLS is explicitly 'false'", async () => {
    const prev = process.env.USE_PRESIGNED_URLS;
    process.env.USE_PRESIGNED_URLS = "false";
    try {
      const url = await getPresignedDownloadUrl("any-key");
      assert.equal(url, null);
    } finally {
      if (prev !== undefined) process.env.USE_PRESIGNED_URLS = prev;
      else delete process.env.USE_PRESIGNED_URLS;
    }
  });
});

// =============================================================================
// VQ-R-020 — forms delivery must not degrade invisibly or serve the wrong doc.
//
// findInContentDir's pass-2 fuzzy substring match can serve a DIFFERENT
// document whose normalized name merely overlaps the requested one. That pass
// is now dev-only (allowFuzzy defaults to IS_DEV), and every fallback serve
// warn-logs its tier so production degradation is observable.
// =============================================================================
describe("findInContentDir fuzzy gating (VQ-R-020)", () => {
  async function makeContentDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vq-content-"));
    await fs.writeFile(path.join(dir, "Student-Handbook-2026.pdf"), "handbook");
    return dir;
  }

  it("serves an exact filename match regardless of fuzzy gating", async () => {
    const dir = await makeContentDir();
    const hit = await findInContentDir("forms/Student-Handbook-2026.pdf", {
      baseDir: dir,
      allowFuzzy: false,
    });
    assert.ok(hit);
    assert.equal(hit.buffer.toString(), "handbook");
  });

  it("refuses a normalized fuzzy match when fuzzy is disallowed (production)", async () => {
    const dir = await makeContentDir();
    // "Student Handbook 2026.pdf" (spaces) normalizes identically to the
    // stored "Student-Handbook-2026.pdf" — pass 1 misses on the exact name,
    // and pass 2 would serve it: the wrong-document hazard the review flagged.
    const hit = await findInContentDir("forms/Student Handbook 2026.pdf", {
      baseDir: dir,
      allowFuzzy: false,
    });
    assert.equal(hit, null);
  });

  it("still allows the fuzzy convenience when explicitly enabled (dev)", async () => {
    const dir = await makeContentDir();
    const hit = await findInContentDir("forms/Student Handbook 2026.pdf", {
      baseDir: dir,
      allowFuzzy: true,
    });
    assert.ok(hit);
    assert.equal(hit.buffer.toString(), "handbook");
  });

  it("returns null for a missing file without touching the fuzzy pass", async () => {
    const dir = await makeContentDir();
    const hit = await findInContentDir("forms/Completely-Unrelated.pdf", {
      baseDir: dir,
      allowFuzzy: false,
    });
    assert.equal(hit, null);
  });
});
