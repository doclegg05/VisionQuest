import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { downloadBundledFile } from "./storage";

describe("downloadBundledFile", () => {
  it("loads bundled orientation PDFs from docs-upload", async () => {
    const result = await downloadBundledFile(
      "orientation/SPOKES_Student_Profile_FY26_Fillable.pdf",
    );

    assert.ok(result);
    assert.equal(result.mimeType, "application/pdf");
    assert.ok(result.buffer.byteLength > 0);
  });

  it("rejects path traversal attempts", async () => {
    const result = await downloadBundledFile("../package.json");
    assert.equal(result, null);
  });
});
