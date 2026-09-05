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
// WHAT THIS CHECK DOES NOT CATCH. Written down because a named guard invites
// the assumption that the output is verified, and it is not:
//
//   - Quantities and durations. "two years at Kroger" passes whenever Kroger
//     is on the résumé; nothing here knows how long they were there.
//   - Tense and status. "works at Kroger" and "worked at Kroger" are the same
//     to this code, and only one of them may still be true.
//   - Predictions and opinions. "will be reliable", "is the best student I
//     have taught" name nothing, so nothing is flagged.
//   - Anything asserted in lower case that is not credential-shaped. The
//     collectors look for capitalised runs and credential nouns; "he has a
//     clean record" gets through.
//
// So this is a BACKSTOP against the specific failure that would be worst —
// a fabricated employer or credential — and not a verifier. The control is
// that an instructor reads and edits every draft before it can be sent, and
// that the endorsement is shown to the student before they approve.
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
 * Everything the draft is allowed to NAME, as one lower-cased haystack.
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
 * The NARROWER haystack, for claims that a person was credentialed.
 *
 * `skills` and `employers` come off the student's own résumé — they are what
 * the student said about themselves, never checked by anyone. That is a fine
 * source for naming a past employer, and a bad one for "Dana is forklift
 * certified": a résumé skill line reading "forklift" would otherwise ground a
 * certification claim in a letter an employer may hire on. Certifications on
 * `verifiedCertifications` have been confirmed by an instructor, which is the
 * standard a credential claim leaving the program has to meet.
 *
 * The instructor's notes and the attendance line stay in, for the same reason
 * as above: a teacher asserting something about their own student is the
 * authority here, not the thing being guarded against.
 */
export function credentialHaystack(facts: EndorsementFacts): string {
  return normalize(
    [
      ...facts.verifiedCertifications,
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
export interface AssertedClaim {
  phrase: string;
  /**
   * Which haystack has to support it. A `credential` claim is checked against
   * verified certifications only; a `name` claim may be grounded by anything
   * in the facts.
   */
  kind: "name" | "credential";
}

export function assertedClaims(sentence: string): AssertedClaim[] {
  const found: AssertedClaim[] = [];

  // Capitalised runs, minus a leading sentence-initial word (which is
  // capitalised for grammar, not because it is a name).
  const body = sentence.replace(/^\W*\p{Lu}[\p{L}']*\s+/u, " ");
  for (const match of body.matchAll(/\b\p{Lu}[\p{L}'&.-]*(?:\s+\p{Lu}[\p{L}'&.-]*)*/gu)) {
    const phrase = match[0].trim();
    if (phrase.length < 3) continue;
    found.push({ phrase, kind: "name" });
  }

  // Credential shapes, regardless of capitalisation: "forklift card",
  // "OSHA 10 certificate", "CDL license". At most three words of run-up, so a
  // match cannot swallow the whole clause.
  for (const match of sentence.matchAll(
    /((?:[\p{L}\d][\p{L}\d'&.-]*\s+){0,3}[\p{L}\d][\p{L}\d'&.-]*)\s+(card|certificate|certification|license|licence|credential)s?\b/giu,
  )) {
    found.push({ phrase: `${match[1].trim()} ${match[2]}`.trim(), kind: "credential" });
  }

  return found;
}

/** The phrases only, for callers that do not care which haystack applies. */
export function assertedEntities(sentence: string): string[] {
  return assertedClaims(sentence).map((claim) => claim.phrase);
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
  const names = groundedHaystack(facts);
  const credentials = credentialHaystack(facts);
  const violations: GroundingViolation[] = [];

  for (const sentence of splitSentences(draft)) {
    for (const claim of assertedClaims(sentence)) {
      if (!normalize(claim.phrase)) continue;
      const haystack = claim.kind === "credential" ? credentials : names;
      if (isPhraseGrounded(claim.phrase, haystack)) continue;
      violations.push({ sentence, term: claim.phrase });
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
