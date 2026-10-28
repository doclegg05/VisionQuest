import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import { decodeSignaturePng, MAX_SIGNATURE_BYTES, SIGNATURE_DATA_URL_PREFIX } from "./signature-png";

async function pngBuffer(width = 8, height = 8): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
}

const toDataUrl = (buffer: Buffer) => SIGNATURE_DATA_URL_PREFIX + buffer.toString("base64");

describe("decodeSignaturePng", () => {
  it("accepts a complete, small PNG and returns its bytes", async () => {
    const png = await pngBuffer();
    const result = await decodeSignaturePng(toDataUrl(png));
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.buffer.equals(png));
  });

  it("rejects an empty or non-canonical payload as malformed", async () => {
    assert.deepEqual(await decodeSignaturePng(SIGNATURE_DATA_URL_PREFIX), { ok: false, reason: "malformed" });
    assert.deepEqual(await decodeSignaturePng(SIGNATURE_DATA_URL_PREFIX + "not base64!"), { ok: false, reason: "malformed" });
  });

  it("rejects a PNG missing its IEND trailer as malformed", async () => {
    const truncated = (await pngBuffer()).subarray(0, -12);
    assert.deepEqual(await decodeSignaturePng(toDataUrl(truncated)), { ok: false, reason: "malformed" });
  });

  it("rejects a payload over the byte limit before decoding it", async () => {
    const oversized = Buffer.alloc(MAX_SIGNATURE_BYTES + 3, 0);
    assert.deepEqual(await decodeSignaturePng(toDataUrl(oversized)), { ok: false, reason: "malformed" });
  });

  it("reports why a structurally complete but oversized image was refused", async () => {
    const tooWide = await pngBuffer(5000, 1);
    const result = await decodeSignaturePng(toDataUrl(tooWide));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "undecodable" && result.detail.length > 0);
  });
});
