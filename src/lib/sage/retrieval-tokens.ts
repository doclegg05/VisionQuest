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

/**
 * Everyday first-day paperwork questions rarely name "orientation". Without
 * that context, "sign" alone can rank a daily sign-in sheet above the
 * onboarding checklist. Expand only that combined intent, leaving attendance,
 * account sign-in and employment paperwork searches alone. This changes the
 * retrieval query, never the student's message or the source material.
 */
export function expandOnboardingPaperworkQuery(message: string): string {
  const paperwork = /\b(?:papers?|paperwork|forms?|documents?|sign|signing|signed)\b/i.test(message);
  const onboarding = /\b(?:first (?:start|day|class|visit)|new (?:here|student)|(?:join|joining|start|starting) (?:the )?(?:spokes|program|class)|just (?:joined|started))\b/i.test(message);
  const employment = /\b(?:job|employer|employment|workplace|work)\b/i.test(message);
  return paperwork && onboarding && !employment
    ? `${message}\norientation onboarding checklist required forms signatures`
    : message;
}
