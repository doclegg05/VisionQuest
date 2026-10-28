import sharp from "sharp";

export const SIGNATURE_DATA_URL_PREFIX = "data:image/png;base64,";
export const MAX_SIGNATURE_BYTES = 500_000;
// Longest canonical base64 string that can decode to MAX_SIGNATURE_BYTES.
const MAX_SIGNATURE_BASE64_LENGTH = Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4;
const MAX_SIGNATURE_SIDE_PX = 4096;
const MAX_SIGNATURE_PIXELS = 4_000_000;
// Zero-length IEND chunk plus its CRC: the last 12 bytes of every complete PNG.
const PNG_IEND_TRAILER = Buffer.from("0000000049454e44ae426082", "hex");
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type SignatureDecodeResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "malformed" | "too_large" }
  | { ok: false; reason: "undecodable"; detail: string };

/**
 * Validate a signature data URL down to its pixels. Buffer.from alone accepts
 * empty or garbage base64, and header/metadata checks alone miss truncated or
 * corrupt image data, so this requires a canonical bounded payload, the IEND
 * trailer (libvips decodes pixels even without it), and a full pixel decode.
 */
export async function decodeSignaturePng(dataUrl: string): Promise<SignatureDecodeResult> {
  const base64Data = dataUrl.slice(SIGNATURE_DATA_URL_PREFIX.length);
  if (!base64Data || base64Data.length > MAX_SIGNATURE_BASE64_LENGTH || !CANONICAL_BASE64.test(base64Data)) {
    return { ok: false, reason: "malformed" };
  }
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (buffer.toString("base64") !== base64Data || !buffer.subarray(-PNG_IEND_TRAILER.length).equals(PNG_IEND_TRAILER)) {
    return { ok: false, reason: "malformed" };
  }
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_SIGNATURE_PIXELS, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height ||
        metadata.width > MAX_SIGNATURE_SIDE_PX || metadata.height > MAX_SIGNATURE_SIDE_PX ||
        (metadata.pages ?? 1) !== 1) {
      return { ok: false, reason: "undecodable", detail: "unsupported dimensions, format or page count" };
    }
    await image.raw().toBuffer();
  } catch (error: unknown) {
    return { ok: false, reason: "undecodable", detail: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, buffer };
}
