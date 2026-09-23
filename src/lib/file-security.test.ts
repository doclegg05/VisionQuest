import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectedFileType, safeDownloadFilename, safeDownloadType, validateUploadContent } from "./file-security";

describe("file content security", () => {
  const signatures: [string, Buffer][] = [
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ["image/jpeg", Buffer.from([255, 216, 255, 224])],
    ["image/gif", Buffer.from("GIF89a")],
  ];
  it("recognizes allowed signatures and rejects mismatched MIME claims", () => {
    for (const [type, bytes] of signatures) {
      assert.equal(detectedFileType(bytes), type);
      assert.equal(validateUploadContent(bytes, type), null);
      assert.notEqual(validateUploadContent(bytes, "text/html"), null);
    }
  });
  it("rejects empty, HTML and SVG payloads disguised as permitted types", () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("<html><script>alert(1)</script>"), Buffer.from("<svg onload='alert(1)'/>")]) {
      for (const [type] of signatures) assert.notEqual(validateUploadContent(bytes, type), null);
      assert.equal(detectedFileType(bytes), null);
    }
  });
  it("does not allow active response types or response-header injection", () => {
    for (const type of ["text/html", "image/svg+xml", "text/xml", "application/pdf\r\nX-Test: yes"]) {
      assert.equal(safeDownloadType(type), "application/octet-stream");
    }
    assert.equal(safeDownloadType("application/pdf"), "application/pdf");
    const filename = safeDownloadFilename('title.pdf";x="\r\nX-Test: yes');
    assert.ok(!/["\r\n;]/.test(filename));
  });
});
