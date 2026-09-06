import path from "path";

/**
 * Sanitize a user-supplied upload filename before it is persisted.
 *
 * `File.name` comes straight from the browser's multipart part and undici
 * preserves it verbatim, so `filename="../../../../home/staff/.bashrc"`
 * survives `req.formData()` intact. `generateStorageKey` already throws the
 * name away for the STORAGE key (it is UUID-based), but the `filename` column
 * is an unsanitized parallel copy that later code — the retention archive's
 * ZIP entry names, download headers, teacher-facing lists — treats as if it
 * were a name rather than a path.
 *
 * This is the upload-time layer: keep the name READABLE, because the student
 * and their instructor identify the file by it, but never let it be a path.
 * The archive boundary applies its own stricter pass on top (`safeEntryName`
 * in `student-archive.ts`), because rows written before this existed are
 * still in the database.
 */

/** C0 and C1 control characters, NUL included. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Anything that could still read as a separator or a drive spec. */
const SEPARATOR_CHARS = /[/\\:]/g;

const DEFAULT_MAX_LENGTH = 200;

/** Longest suffix still treated as an extension worth preserving. */
const MAX_KEPT_EXTENSION = 12;

export const FALLBACK_UPLOAD_NAME = "file";

export function safeUploadName(
  rawName: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  if (typeof rawName !== "string") return FALLBACK_UPLOAD_NAME;

  // Backslashes first: a Windows-style "..\..\x" must lose its components too,
  // and posix `basename` would otherwise hand back the whole string.
  const normalized = rawName.replace(/\\/g, "/").replace(CONTROL_CHARS, "");

  let name = path.posix.basename(normalized);

  // basename cannot produce a separator, but a name that was entirely
  // separators (or a drive spec) can still leave one behind.
  name = name.replace(SEPARATOR_CHARS, "_");

  // "." and ".." are path segments, not names, and a leading dot also hides
  // the file from ordinary listings once extracted.
  name = name.replace(/^\.+/, "").trim();

  if (!name) return FALLBACK_UPLOAD_NAME;

  if (name.length > maxLength) {
    const ext = path.posix.extname(name);
    const keptExt = ext.length > 0 && ext.length <= MAX_KEPT_EXTENSION ? ext : "";
    name = name.slice(0, Math.max(1, maxLength - keptExt.length)) + keptExt;
  }

  return name || FALLBACK_UPLOAD_NAME;
}
