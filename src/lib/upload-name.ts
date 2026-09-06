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

/**
 * Characters that carry no visible glyph. `\p{Cc}` is exactly the C0 and C1
 * controls this used to enumerate (NUL included); `\p{Cf}` adds the format
 * characters.
 *
 * `\p{Cf}` is the 2026-09-06 addition, and it is not cosmetic. It covers the
 * bidi overrides and isolates (U+202A-U+202E, U+2066-U+2069): a file named
 * `resume<U+202E>fdp.exe` renders in a teacher's file list as
 * `resumeexe.pdf`, and the staff member deciding whether to open it reads
 * the rendering, not the bytes. It also covers the zero-width characters
 * (U+200B-U+200F), which otherwise let two names that look identical in
 * every list this app renders stay distinct.
 *
 * `safeEntryName` in student-archive.ts already dropped all of these — its
 * allowlist keeps only `\p{L}`/`\p{N}` and a little punctuation — so this
 * brings the upload-time pass into agreement with the archive boundary
 * rather than inventing a new rule.
 */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}]/gu;

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
  const normalized = rawName.replace(/\\/g, "/").replace(INVISIBLE_CHARS, "");

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
