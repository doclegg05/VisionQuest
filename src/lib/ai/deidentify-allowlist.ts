/**
 * Values the de-identification vault must never tokenize.
 *
 * These are not anybody's personal data — they are public help lines and
 * program-level contact details the SYSTEM prompt carries so Sage can hand
 * them to a student. Two reasons they are an explicit allowlist rather than
 * something the patterns happen to miss:
 *
 *  - **Safety.** A tokenized crisis number that failed to re-hydrate would
 *    show a student in crisis `[PHONE_1]`. That is a safety regression, not a
 *    privacy win. (The 988 block itself is appended AFTER generation by
 *    `src/lib/chat/crisis-safety-net.ts`, so it never passes through the
 *    provider — but the system prompt does instruct Sage to surface 988, and
 *    a model that repeats a number from the prompt must repeat it correctly.)
 *  - **Nothing is protected by vaulting them.** They identify an
 *    organisation, not a student.
 *
 * The list is deliberately tiny and literal. It protects THESE values, not
 * "numbers that look official": a student's own phone of the same shape is
 * still tokenized (pinned in deidentify.wave2.test.ts).
 *
 * Adding an entry: it must be a value that is already public, already in the
 * system prompt or program documents, and belongs to an organisation. Never a
 * person's contact detail, whatever their role.
 */
export const DEIDENTIFY_ALLOWLIST: readonly string[] = [
  // 988 Suicide & Crisis Lifeline, and the legacy number still printed on
  // most WV program handouts.
  "988",
  "1-800-273-8255",
  "800-273-8255",
  // Crisis Text Line short code.
  "741741",
] as const;
