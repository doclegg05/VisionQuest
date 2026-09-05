// =============================================================================
// The instructor endorsement — the grounding check, Prisma-free and
// model-free so it can be exercised on adversarial text without a provider.
//
// The endorsement is the one part of the packet written in prose about a
// person, sent to somebody deciding whether to employ them. A model that adds
// "and two years at Kroger" has not been unhelpful — it has put a false
// employment claim in front of an employer under an instructor's name.
//
// So the check runs on the OUTPUT, sentence by sentence, and fails closed: any
// sentence naming an employer, skill or credential that is not in the supplied
// facts is rejected, and the draft is refused rather than trimmed. Trimming
// would leave a fluent paragraph that had quietly dropped its worst sentence,
// which is much harder for an instructor to notice than an empty box.
//
// This module must never import @/lib/db.
// =============================================================================

export interface EndorsementFacts {
  /** Verified certifications only. An unverified card is not a fact yet. */
  verifiedCertifications: string[];
  /** Skills from the student's own résumé. */
  skills: string[];
  /** Employers already on the résumé; anything else is invented. */
  employers: string[];
  /** One-line attendance summary, when a helper supplies one. */
  attendanceSummary: string | null;
  /** Free text the instructor typed. Their own words are always grounded. */
  instructorNotes: string | null;
}

/** Split into sentences without swallowing the last one when it has no stop. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/**
 * Everything the draft is allowed to assert, as one lower-cased haystack.
 *
 * The instructor's own notes and the attendance line are included: a person
 * writing about their own student is the source of truth this check exists to
 * protect, not something to police.
 */
export function groundedHaystack(facts: EndorsementFacts): string {
  return normalize(
    [
      ...facts.verifiedCertifications,
      ...facts.skills,
      ...facts.employers,
      facts.attendanceSummary ?? "",
      facts.instructorNotes ?? "",
    ].join(" \n "),
  );
}

/**
 * Terms a sentence may use freely: the program's own vocabulary and ordinary
 * connective English. Without this every sentence mentioning "SPOKES" or "the
 * class" would be flagged, and a check that flags everything gets turned off.
 */
const PROGRAM_VOCABULARY = [
  "spokes",
  "the program",
  "class",
  "classes",
  "course",
  "instructor",
  "teacher",
  "student",
  "work",
  "job",
  "shift",
  "team",
];

/** The nouns that turn a name into a credential claim. */
const CREDENTIAL_NOUNS = [
  "card",
  "certificate",
  "certification",
  "license",
  "licence",
  "credential",
];

/**
 * Every proper-noun-ish or credential-ish phrase a sentence asserts.
 *
 * Deliberately over-collects — capitalised multi-word runs, and anything that
 * looks like a credential ("... card", "... certificate", "... license") — and
 * `isPhraseGrounded` then decides. Over-collecting costs an instructor one
 * rewrite; under-collecting puts a fabricated employer in an employer's inbox.
 */
export function assertedEntities(sentence: string): string[] {
  const found: string[] = [];

  // Capitalised runs, minus a leading sentence-initial word (which is
  // capitalised for grammar, not because it is a name).
  const body = sentence.replace(/^\W*\p{Lu}[\p{L}']*\s+/u, " ");
  for (const match of body.matchAll(/\b\p{Lu}[\p{L}'&.-]*(?:\s+\p{Lu}[\p{L}'&.-]*)*/gu)) {
    const phrase = match[0].trim();
    if (phrase.length < 3) continue;
    found.push(phrase);
  }

  // Credential shapes, regardless of capitalisation: "forklift card",
  // "OSHA 10 certificate", "CDL license". At most three words of run-up, so a
  // match cannot swallow the whole clause.
  for (const match of sentence.matchAll(
    /((?:[\p{L}\d][\p{L}\d'&.-]*\s+){0,3}[\p{L}\d][\p{L}\d'&.-]*)\s+(card|certificate|certification|license|licence|credential)s?\b/giu,
  )) {
    found.push(`${match[1].trim()} ${match[2]}`.trim());
  }

  return found;
}

/**
 * Is this phrase supported by the facts?
 *
 * Matched by word-SUFFIX, not whole string, because both collectors pick up
 * run-up words the grammar supplied rather than the claim: "Dana earned the
 * Forklift Operator card" is one credential phrase whose actual assertion is
 * "Forklift Operator". Trying each suffix from the right finds the claim
 * without letting a leading verb turn a true statement into a violation.
 *
 * Suffixes shorter than three characters are skipped so a stray "10" or "a"
 * cannot ground a phrase by colliding with an unrelated number in the facts.
 */
export function isPhraseGrounded(phrase: string, haystack: string): boolean {
  const words = phrase.split(/\s+/u).filter(Boolean);
  // The credential noun is the collector's, not the claim's: the facts record
  // "Forklift Operator", and the draft that says "the Forklift Operator card"
  // is asserting the same thing. Strip it before matching, or every true
  // credential sentence fails.
  while (
    words.length > 1 &&
    CREDENTIAL_NOUNS.includes(normalize(words[words.length - 1]).replace(/s$/u, ""))
  ) {
    words.pop();
  }
  for (let start = 0; start < words.length; start += 1) {
    const suffix = normalize(words.slice(start).join(" "));
    if (suffix.length < 3) continue;
    if (PROGRAM_VOCABULARY.includes(suffix)) return true;
    if (haystack.includes(suffix)) return true;
  }
  return false;
}

export interface GroundingViolation {
  sentence: string;
  term: string;
}

/**
 * Sentences that assert something the facts do not support.
 *
 * Empty array = the draft may be shown to the instructor. Anything else and
 * the caller refuses the draft outright.
 */
export function findUngroundedSentences(
  draft: string,
  facts: EndorsementFacts,
): GroundingViolation[] {
  const haystack = groundedHaystack(facts);
  const violations: GroundingViolation[] = [];

  for (const sentence of splitSentences(draft)) {
    for (const term of assertedEntities(sentence)) {
      if (!normalize(term)) continue;
      if (isPhraseGrounded(term, haystack)) continue;
      violations.push({ sentence, term });
    }
  }

  return violations;
}

export function isEndorsementGrounded(draft: string, facts: EndorsementFacts): boolean {
  return findUngroundedSentences(draft, facts).length === 0;
}

/** What the packet carries when no endorsement has been drafted or kept. */
export const NO_ENDORSEMENT_TEXT = "";

/** Bound on what an instructor may store, matching packetSchema. */
export const MAX_ENDORSEMENT_CHARS = 2000;
