import { createHash } from "node:crypto";

/**
 * A one-way correlation key for a student, safe to put in server logs.
 *
 * Server logs carry no student identifier (.claude/rules/security.md, Data
 * Privacy), but many failure paths are logged precisely because nothing reached
 * the database — a failed StudentAlert upsert or MoodEntry write leaves the log
 * line as the only trace. Dropping the identifier outright would make those
 * lines unfollowable, so log this key instead: two failures for the same student
 * correlate, and the log alone still identifies nobody.
 *
 * No salt. Student ids are high-entropy cuids rather than guessable values like
 * an email or phone number, so there is no dictionary to run against the digest.
 * Anyone who could hash every id to match one already has the database.
 *
 * This is a debugging aid, not a pseudonymous identifier: do not store it, index
 * it, or send it anywhere a raw id would be disallowed.
 */
export function studentLogKey(studentId: string): string {
  if (typeof studentId !== "string" || studentId.length === 0) {
    return "stu_unknown";
  }

  const digest = createHash("sha256").update(studentId).digest("hex");

  return `stu_${digest.slice(0, 12)}`;
}
