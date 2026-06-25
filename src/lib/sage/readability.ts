// =============================================================================
// Readability — plain-language guard for Sage's replies.
//
// SPOKES serves adults with a wide literacy range; the brand calls for a ~6th-
// grade reading level. This module scores text deterministically (no model
// call) using Flesch-Kincaid so we can measure and flag when Sage drifts into
// jargon or long, dense sentences — in the quality eval and as a runtime signal.
//
// Dependency-free (works in the standalone server bundle and in node test).
// =============================================================================

/** The brand's ideal — short, plain replies a 6th grader could read. */
export const PLAIN_LANGUAGE_IDEAL_GRADE = 6;
/** Guard ceiling — at/under this is fine; above it is flagged. A little slack
 *  over the ideal absorbs unavoidable proper nouns (QuickBooks, WorkKeys). */
export const PLAIN_LANGUAGE_MAX_GRADE = 8;
/** Below this word count Flesch-Kincaid is too noisy to judge ("Got it!"). */
const MIN_SCORABLE_WORDS = 12;

export interface ReadabilityStats {
  words: number;
  sentences: number;
  syllables: number;
}

export interface ReadabilityAssessment {
  /** Flesch-Kincaid grade level (rounded to 1 decimal). */
  grade: number;
  /** Flesch reading-ease score (0-100; higher is easier). */
  ease: number;
  words: number;
  sentences: number;
  /** False for very short replies where the metric is unreliable. */
  scorable: boolean;
  /** scorable && grade <= maxGrade. Short replies are always within target. */
  withinTarget: boolean;
}

/**
 * Strip markdown/URLs so formatting doesn't skew the score — we want the
 * reading level of what the student actually reads.
 */
function stripFormatting(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [label](url) -> label
    .replace(/https?:\/\/\S+/g, " ") // bare urls
    .replace(/[*_`#>~|]/g, " ") // md punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic syllable count for a single word. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  // Drop a trailing silent "e" (make -> 1), but keep the "-le" syllable
  // (table -> 2), which is the common exception.
  if (w.endsWith("e") && !w.endsWith("le")) count -= 1;
  return Math.max(1, count);
}

export function readabilityStats(text: string): ReadabilityStats {
  const clean = stripFormatting(text);
  const wordTokens = clean.match(/[a-zA-Z0-9']+/g) ?? [];
  const sentenceTokens = clean.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = wordTokens.length;
  const sentences = Math.max(1, sentenceTokens.length);
  const syllables = wordTokens.reduce((sum, w) => sum + countSyllables(w), 0);
  return { words, sentences, syllables };
}

export function fleschKincaidGrade(text: string): number {
  const { words, sentences, syllables } = readabilityStats(text);
  if (words === 0) return 0;
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

export function fleschReadingEase(text: string): number {
  const { words, sentences, syllables } = readabilityStats(text);
  if (words === 0) return 100;
  return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
}

export function assessReadability(
  text: string,
  options: { maxGrade?: number } = {},
): ReadabilityAssessment {
  const maxGrade = options.maxGrade ?? PLAIN_LANGUAGE_MAX_GRADE;
  const { words, sentences } = readabilityStats(text);
  const grade = Math.round(fleschKincaidGrade(text) * 10) / 10;
  const ease = Math.round(fleschReadingEase(text) * 10) / 10;
  const scorable = words >= MIN_SCORABLE_WORDS;
  return {
    grade,
    ease,
    words,
    sentences,
    scorable,
    // Too-short replies can't be judged, so they never count as over-target.
    withinTarget: !scorable || grade <= maxGrade,
  };
}
