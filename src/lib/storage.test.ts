import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";
import fs from "node:fs/promises";
import {
  downloadBundledFile,
  downloadFile,
  uploadFile,
  deleteFile,
  storageObjectExists,
  generateStorageKey,
  validateFile,
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

describe("storage key boundary", () => {
  const invalidKeys = ["../public.pdf", "forms/../../public.pdf", "forms/../public.pdf", "/public.pdf", "C:\\public.pdf", "forms\\public.pdf", "forms//public.pdf", "forms/./public.pdf", "public.pdf\u0000", ""];

  it("does not let traversal fall through to content basename lookup", async () => {
    const read = mock.method(fs, "readFile", async () => Buffer.from("%PDF-1.7"));
    const list = mock.method(fs, "readdir", async () => [{ name: "public.pdf", isDirectory: () => false, isFile: () => true }]);
    try {
      for (const key of invalidKeys) {
        assert.equal(await downloadBundledFile(key), null, key);
        assert.equal(await downloadFile(key), null, key);
      }
      assert.equal(read.mock.callCount(), 0);
      assert.equal(list.mock.callCount(), 0);
    } finally {
      read.mock.restore();
      list.mock.restore();
    }
  });

  it("rejects unsafe keys before write, delete, HEAD or signing", async () => {
    for (const key of invalidKeys) {
      await assert.rejects(uploadFile(key, Buffer.from("test"), "application/pdf"), /Invalid storage path/);
      await assert.rejects(deleteFile(key), /Invalid storage path/);
      await assert.rejects(storageObjectExists(key), /Invalid storage path/);
      await assert.rejects(getPresignedDownloadUrl(key), /Invalid storage path/);
    }
  });

  it("rejects unsafe namespaces and strips unsafe filename extensions", () => {
    assert.throws(() => generateStorageKey("../student", "test.pdf"));
    assert.throws(() => generateStorageKey("student/nested", "test.pdf"));
    assert.match(generateStorageKey("student", "TEST.PDF"), /^student\/[a-f0-9-]+\.pdf$/);
    assert.match(generateStorageKey("student", "test.pdf\r\nX: yes"), /^student\/[a-f0-9-]+$/);
    assert.ok(validateFile({ size: 0, type: "application/pdf" }));
    assert.ok(validateFile({ size: NaN, type: "application/pdf" }));
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
