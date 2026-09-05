/**
 * The one definition of "a character that must not survive into a prompt".
 *
 * WHY THIS IS ITS OWN MODULE. `sanitizeForPrompt` (./system-prompts.ts) strips
 * these, and the posting-injection benchmark scorer
 * (scripts/bench/suites/posting-injection.mjs) checks that nothing from the set
 * survived any boundary. When those two carried their own copies, the benchmark
 * could only ever measure the characters the sanitizer already knew about —
 * a gate that cannot fail, and it did not fail while soft hyphen, RLM, the
 * variation selectors and the Unicode tag characters all passed straight
 * through. Both sides now import from here, so the measurement and the defence
 * cannot drift apart again. Dependency-free on purpose (same reason as
 * ./prompt-revision.ts): a benchmark scorer must be able to import it without
 * dragging in the prompt stack or Prisma.
 *
 * TWO SETS, TWO REMEDIES, because the hazards are not the same:
 *
 *   INVISIBLE_CHAR_CLASS is DELETED. These render as nothing at all, so they
 *   hide content from a human reviewer while a tokenizer still sees them. That
 *   is what lets "[GROUNDING<ZWSP>_DATA_END]" read as a fence marker to the
 *   model while being invisible in the teacher console. Deleting rejoins the
 *   token into the canonical shape the delimiter sweeps already remove;
 *   replacing with a space would leave "[GROUNDING _DATA_END]", which
 *   DELIMITER_SHAPED does not match because it allows whitespace only at a
 *   token's edges.
 *
 *   AMBIGUOUS_SPACE_CLASS is NORMALIZED to a plain ASCII space. These DO have
 *   visible width, so deleting them would fuse two words in text a human
 *   reads. They are still not safe to pass through: JS `\s` matches most of
 *   them, so they can stand in for a space anywhere our own parsing assumes
 *   one, and U+2028/U+2029 act as line breaks in some renderers — the same
 *   "forge a second message" hazard `sanitizeSmsValue` guards against.
 *
 * WHAT IS DELIBERATELY KEPT: "\n" and "\t". They are prompt structure — the
 * grounding fence and every rendered context block are built out of newlines.
 * Everything else in the C0/C1 range, NUL and ESC included, goes.
 *
 * ACCEPTED COLLATERAL, stated so the next reader does not have to rediscover
 * it: U+200D (zero-width joiner) is deleted, which breaks ZWJ emoji sequences
 * (a family emoji degrades into its component people) and Devanagari/Indic
 * conjunct forms. U+FE0F is deleted, so an emoji may render in its text rather
 * than emoji presentation. "\r" is deleted, so CRLF input becomes LF. These
 * are worth it here because this text is third-party job-feed and staff-typed
 * content, not user-authored messages — but note that `sanitizeForPrompt` is
 * NOT prompt-only: its output is persisted by
 * src/app/api/connect/employer/[token]/not-now/route.ts and rendered to humans
 * through the packet and endorsement paths, so the degradation is visible.
 */

/**
 * Character class BODY (no enclosing brackets) for characters that are deleted
 * outright. Ordered by code point. Requires the `u` flag for the astral tag
 * range.
 */
export const INVISIBLE_CHAR_CLASS =
  "\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F" + // C0/C1 controls, minus \t and \n
  "\\u00AD" + // soft hyphen
  "\\u061C" + // arabic letter mark
  "\\u180E" + // mongolian vowel separator
  "\\u200B-\\u200F" + // ZWSP, ZWNJ, ZWJ, LRM, RLM
  "\\u202A-\\u202E" + // bidi embeddings and overrides
  "\\u2060-\\u2064" + // word joiner, invisible times/separator/plus
  "\\u2066-\\u2069" + // bidi isolates
  "\\uFE00-\\uFE0F" + // variation selectors
  "\\uFEFF" + // BOM / zero-width no-break space
  "\\uFFF9-\\uFFFB" + // interlinear annotation anchors
  "\\u{E0000}-\\u{E007F}" + // tag characters (the "invisible text" block)
  "\\u{E0100}-\\u{E01EF}"; // variation selectors supplement

/**
 * Character class BODY for whitespace that is not a plain ASCII space and is
 * normalized to one.
 */
export const AMBIGUOUS_SPACE_CLASS =
  "\\u00A0" + // no-break space
  "\\u1680" + // ogham space mark
  "\\u2000-\\u200A" + // en quad .. hair space
  "\\u2028\\u2029" + // line / paragraph separator
  "\\u202F" + // narrow no-break space
  "\\u205F" + // medium mathematical space
  "\\u3000"; // ideographic space

/** Non-global, so `.test()`/`.exec()` carry no `lastIndex` state for callers. */
export const INVISIBLE_CHAR_RE = new RegExp(`[${INVISIBLE_CHAR_CLASS}]`, "u");
export const AMBIGUOUS_SPACE_RE = new RegExp(`[${AMBIGUOUS_SPACE_CLASS}]`, "u");

const INVISIBLE_CHAR_RE_G = new RegExp(`[${INVISIBLE_CHAR_CLASS}]`, "gu");
const AMBIGUOUS_SPACE_RE_G = new RegExp(`[${AMBIGUOUS_SPACE_CLASS}]`, "gu");

/**
 * Delete the invisible characters, normalize the ambiguous spaces.
 *
 * ONE PASS OF EACH IS ENOUGH, unlike the delimiter sweep that follows it, and
 * the reason is structural rather than empirical: `replace` only ever removes
 * characters or substitutes a space, so no character from either class can be
 * produced by running it. Deleting an invisible character cannot create an
 * ambiguous space, normalizing a space cannot create an invisible character,
 * and every member of both classes is a single code point (the astral ranges
 * are matched whole under the `u` flag, so no surrogate half is ever left
 * behind to pair with a neighbour). Order between the two is therefore
 * irrelevant; the delimiter loop that follows still needs its loop, because
 * removing a delimiter CAN join its neighbours into a new one.
 */
export function stripInvisibleChars(value: string): string {
  return value.replace(INVISIBLE_CHAR_RE_G, "").replace(AMBIGUOUS_SPACE_RE_G, " ");
}
