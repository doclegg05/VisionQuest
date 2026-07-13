import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// Proves the production storage path end-to-end without mocking the SDK:
// a real S3 GetObject request hits a local endpoint that answers 404 for
// every key, and downloadFile must fall back to the bundled docs-upload copy.
// (mock.module can't intercept bare npm specifiers like @aws-sdk/* under tsx
// — see JOURNAL.md 2026-07-10 — so this uses a live loopback endpoint.)
//
// Env is set BEFORE the storage module is imported because the S3 client is
// built at module load. This file must not statically import @/lib/storage.

const STUDENT_PROFILE_KEY = "orientation/SPOKES_Student_Profile_FY26_Fillable.pdf";

let server: http.Server;
let requestsSeen = 0;
let storage: typeof import("@/lib/storage");

before(async () => {
  server = http.createServer((req, res) => {
    requestsSeen += 1;
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/xml");
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?>'
        + "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  process.env.STORAGE_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.STORAGE_BUCKET = "forms-delivery-test";
  process.env.STORAGE_ACCESS_KEY = "test-access-key";
  process.env.STORAGE_SECRET_KEY = "test-secret-key";
  delete process.env.USE_PRESIGNED_URLS;

  storage = await import("@/lib/storage");
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("downloadFile falls back to bundled PDFs when the bucket object is missing", () => {
  it("serves the SPOKES Student Profile (Sage's 'Open form' target) from the bundled copy", async () => {
    const result = await storage.downloadFile(STUDENT_PROFILE_KEY);

    assert.ok(requestsSeen > 0, "the S3 endpoint was never contacted — prod path not exercised");
    assert.ok(result, "downloadFile returned null despite the bundled fallback");
    assert.equal(result.mimeType, "application/pdf");

    const bundledPath = path.join(process.cwd(), "docs-upload", STUDENT_PROFILE_KEY);
    assert.ok(existsSync(bundledPath), `bundled source missing: ${bundledPath}`);
    assert.ok(result.buffer.equals(readFileSync(bundledPath)), "fallback bytes differ from the bundled source");
  });

  it("resolves renamed bucket prefixes (students/resources/ → students/)", async () => {
    const result = await storage.downloadFile(
      "students/resources/SPOKES Life and Employability Module Rubric Record.pdf",
    );

    assert.ok(result, "renamed-prefix key did not resolve to its bundled copy");
    assert.equal(result.mimeType, "application/pdf");
  });

  it("still returns null when no bundled copy exists either", async () => {
    const result = await storage.downloadFile("orientation/definitely-not-a-real-form.pdf");
    assert.equal(result, null);
  });

  it("rejects path-traversal storage keys instead of escaping docs-upload/", async () => {
    const result = await storage.downloadFile("../../package.json");
    assert.equal(result, null);
  });
});
