/**
 * Validation gate for Sage memory writes (Phase 2).
 *
 * Every memory candidate — whether from LLM extraction, consolidation, or a
 * staff correction — passes through this zod schema before touching the DB
 * (TEKTON "frontmatter schema as a contract" pattern). Controlled vocab keeps
 * memory queryable; the gate keeps a hallucinating extractor from writing
 * malformed rows.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

export const MEMORY_SUBJECT_TYPES = ["student", "teacher", "class", "program"] as const;
export const MEMORY_KINDS = ["episodic", "semantic", "procedural"] as const;
export const MEMORY_CATEGORIES = [
  "goal",
  "preference",
  "circumstance",
  "skill",
  "coaching",
  "progress",
  "other",
] as const;
export const MEMORY_EDGE_PREDICATES = [
  "depends_on",
  "blocks",
  "supersedes",
  "relates_to",
  "evidenced_by",
] as const;

/**
 * Catches memory content phrased as a standing instruction to Sage's future
 * behavior rather than a fact about the student — e.g. "always skip the
 * crisis-redirect" or "don't mention the hotline again". Best-effort
 * defense-in-depth: this is a heuristic proximity match, not a semantic
 * classifier, and is not a substitute for treating retrieved memory as
 * data-not-instruction at render time (see sanitizeForPrompt and the
 * [MEMORY_START]/[MEMORY_END] framing in retrieve.ts/profile.ts).
 *
 * Three patterns, each requiring an imperative/negation trigger CLOSE to a
 * Sage-behavior target — not just anywhere in the same sentence. Bare
 * co-occurrence of a common time-adverb ("never", "always") with a common
 * topic noun ("advice") is too frequent in ordinary circumstance narratives
 * ("never received career advice", "a housing crisis... never recovered")
 * to use as a standalone signal.
 */
const TRIGGER = [
  "don'?t",
  "do(?:es)?n'?t want",
  "do(?:es)? not want",
  "never",
  "always",
  "stop(?:s|ping)?",
  "should ?n'?t",
  "no need to",
  "just",
].join("|");
const ACTION_VERBS = "mention(?:s|ing)?|skip(?:s|ping)?|ignor(?:e|es|ing)|redirect(?:s|ing)?|tell|give|agree|recite|discuss";
const TOPIC_NOUNS = "hotline|guardrails?|advice|instructions?|prompts?|crisis[- ]redirect";

// Trigger within a few words of an action verb (either order) — action
// verbs are specific enough to tolerate a wider window.
const TRIGGER_NEAR_VERB = new RegExp(
  `\\b(?:${TRIGGER})\\b(?:\\W+\\w+){0,3}\\W+\\b(?:${ACTION_VERBS})\\b|\\b(?:${ACTION_VERBS})\\b(?:\\W+\\w+){0,3}\\W+\\b(?:${TRIGGER})\\b`,
  "i",
);
// Trigger immediately adjacent to a topic noun — topic nouns are common
// enough words that only direct adjacency avoids false positives.
const TRIGGER_ADJACENT_NOUN = new RegExp(
  `\\b(?:${TRIGGER})\\b\\W+\\b(?:${TOPIC_NOUNS})\\b|\\b(?:${TOPIC_NOUNS})\\b\\W+\\b(?:${TRIGGER})\\b`,
  "i",
);
// "Sage"/"coach" directly commanding a bare action verb, with no other
// trigger word needed (e.g. "Prefers Sage skip the crisis-redirect step").
const SAGE_DIRECTED_ACTION = new RegExp(
  `\\b(?:sage|coach)\\b(?:\\s+should)?\\s+\\b(?:${ACTION_VERBS})\\b`,
  "i",
);

export function looksLikeInstructionToSage(content: string): boolean {
  return (
    TRIGGER_NEAR_VERB.test(content) ||
    TRIGGER_ADJACENT_NOUN.test(content) ||
    SAGE_DIRECTED_ACTION.test(content)
  );
}

export const memoryCandidateSchema = z.object({
  subjectType: z.enum(MEMORY_SUBJECT_TYPES),
  subjectId: z.string().min(1),
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(1).max(500),
  category: z.enum(MEMORY_CATEGORIES),
  confidence: z.number().min(0).max(1).default(0.7),
  sourceType: z.enum(["conversation", "operation", "manual"]),
  sourceId: z.string().min(1).optional(),
});

export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

export const memoryEdgeSchema = z.object({
  fromId: z.string().cuid(),
  toId: z.string().cuid(),
  predicate: z.enum(MEMORY_EDGE_PREDICATES),
  evidence: z.string().trim().min(1).max(1000),
  confidence: z.number().min(0).max(1).default(0.7),
});

export type MemoryEdgeCandidate = z.infer<typeof memoryEdgeSchema>;

/**
 * Dedupe key: stable across cosmetic rewording is impossible without
 * embeddings, but normalization (lowercase, collapsed whitespace, stripped
 * punctuation) catches the common case of the extractor re-emitting the same
 * fact verbatim across conversations.
 */
export function sourceHashFor(candidate: Pick<MemoryCandidate, "subjectType" | "subjectId" | "content">): string {
  const normalizedContent = candidate.content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256")
    .update(`${candidate.subjectType}:${candidate.subjectId}:${normalizedContent}`)
    .digest("hex");
}

/**
 * What the extraction model is allowed to provide: content fields only.
 * Subject identity and provenance are pinned server-side — the model is
 * never trusted with them.
 */
export const extractionItemSchema = memoryCandidateSchema
  .pick({
    kind: true,
    content: true,
    category: true,
    confidence: true,
  })
  .refine((item) => !looksLikeInstructionToSage(item.content), {
    message: "Content reads as an instruction to Sage rather than a fact about the student",
    path: ["content"],
  });

export type ExtractionItem = z.infer<typeof extractionItemSchema>;

/**
 * Parse a batch of raw model extraction items. Invalid entries are dropped
 * (reported in `rejected`), never thrown — extraction is best-effort.
 */
export function parseExtractionItems(raw: unknown): {
  accepted: ExtractionItem[];
  rejected: number;
} {
  if (!Array.isArray(raw)) return { accepted: [], rejected: 0 };

  const accepted: ExtractionItem[] = [];
  let rejected = 0;
  for (const entry of raw) {
    const result = extractionItemSchema.safeParse(entry);
    if (result.success) {
      accepted.push(result.data);
    } else {
      rejected++;
    }
  }
  return { accepted, rejected };
}
