/**
 * Shared keyword tokenizer for Sage retrieval.
 *
 * Used by the keyword-scoring path in knowledge-base-server and by the
 * full-text leg of hybrid retrieval (OR-joined websearch query). Pure module
 * (no Prisma/cache imports) so both server and script contexts can load it.
 */

/**
 * Words too generic to discriminate between program documents — nearly every
 * title/note contains them, so they only add noise to keyword matching.
 */
export const GENERIC_RETRIEVAL_WORDS = new Set([
  "about",
  "category",
  "certificate",
  "certificates",
  "certification",
  "complete",
  "document",
  "documents",
  "file",
  "fillable",
  "form",
  "forms",
  "guide",
  "guides",
  "information",
  "need",
  "needs",
  "platform",
  "program",
  "related",
  "required",
  "student",
  "students",
  "submit",
  "used",
  "uses",
  "using",
  "work",
]);

/** Lowercase alphanumeric tokens of at least minLength, minus generic words. */
export function tokenizeForRetrieval(text: string, minLength: number): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length >= minLength && !GENERIC_RETRIEVAL_WORDS.has(word)) ?? []
  );
}
