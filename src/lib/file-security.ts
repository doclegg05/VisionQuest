// A signature check rejects obvious MIME spoofing; it is not malware scanning
// or a substitute for a document/image parser.
export function detectedFileType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  return null;
}

export function validateUploadContent(buffer: Buffer, mimeType: string): string | null {
  return detectedFileType(buffer) === mimeType
    ? null
    : "File contents do not match the selected file type.";
}

/** Only known passive formats may render inline on our authenticated origin. */
export function safeDownloadType(mimeType: string): string {
  return ["application/pdf", "image/png", "image/jpeg", "image/gif"].includes(mimeType)
    ? mimeType
    : "application/octet-stream";
}

export function safeDownloadFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._\- ]/g, "_").replace(/\.+$/, "").slice(0, 200) || "download";
}
