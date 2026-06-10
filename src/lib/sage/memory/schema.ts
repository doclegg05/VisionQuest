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
 * Parse a batch of raw extraction candidates. Invalid entries are dropped
 * (reported in `rejected`), never thrown — extraction is best-effort.
 */
export function parseMemoryCandidates(raw: unknown): {
  accepted: MemoryCandidate[];
  rejected: number;
} {
  if (!Array.isArray(raw)) return { accepted: [], rejected: 0 };

  const accepted: MemoryCandidate[] = [];
  let rejected = 0;
  for (const entry of raw) {
    const result = memoryCandidateSchema.safeParse(entry);
    if (result.success) {
      accepted.push(result.data);
    } else {
      rejected++;
    }
  }
  return { accepted, rejected };
}
