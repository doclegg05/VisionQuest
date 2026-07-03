import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { downloadBundledFile, getPresignedDownloadUrl } from "./storage";

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
