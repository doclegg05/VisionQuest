/**
 * Post-response memory extraction (Phase 2, Mem0 ADD-only pattern).
 *
 * Runs fire-and-forget after the SSE stream completes (wired in
 * src/lib/chat/post-response.ts). The provider is resolved by the caller via
 * resolveAiProvider(), so FERPA routing (student_record → local-only policy)
 * is inherited from the chat pipeline, never re-decided here.
 *
 * ADD-only: extraction never mutates or deletes existing memories — the
 * consolidation cron owns decay/archival. Dedupe is two-layered: a sourceHash
 * pre-check plus the partial unique index
 * SageMemory_subject_sourceHash_active_key as the race-proof backstop.
 *
 * Never throws to the caller: a failed extraction must not surface as a chat
 * error.
 */

import { prisma } from "@/lib/db";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";
import { logLlmCall } from "@/lib/llm-usage";
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  sourceHashFor,
  type MemoryCandidate,
} from "./schema";

const MAX_MEMORIES_PER_CONVERSATION = 5;

/**
 * Semantic dedupe cutoff: a candidate whose embedding is within this cosine
 * distance of an existing ACTIVE memory is a rephrasing, not a new fact.
 * (0.08 distance ≈ 0.92 similarity.) Overridable via SAGE_MEMORY_DUP_DISTANCE.
 */
const DEFAULT_DUP_DISTANCE = 0.08;

function getDupDistance(): number {
  const raw = Number.parseFloat(process.env.SAGE_MEMORY_DUP_DISTANCE ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_DUP_DISTANCE;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const EXTRACTION_PROMPT = `You are a memory extractor for Sage, an AI coach for adult workforce-development students.

From the conversation, extract up to ${MAX_MEMORIES_PER_CONVERSATION} NEW durable facts worth remembering about the student in future sessions.

Include facts like: goals and career interests, stable preferences (schedule, learning style), life circumstances that affect coaching (transportation, childcare, work history), demonstrated skills or struggles, and coaching approaches that worked or failed.

Do NOT include: greetings or small talk, one-off transient states ("tired today"), facts about other people by name, anything medical/legal/financial beyond what the student volunteered as a circumstance, or restatements of what Sage said.

Respond with ONLY a JSON array (no prose). Each element:
{
  "kind": "episodic" | "semantic" | "procedural",
  "content": "One self-contained sentence, max 500 chars.",
  "category": "goal" | "preference" | "circumstance" | "skill" | "coaching" | "progress" | "other",
  "confidence": 0.0-1.0
}

Return [] if nothing durable was shared.`;

export interface ExtractMemoriesParams {
  provider: AIProvider;
  studentId: string;
  conversationId: string;
  messages: { role: "user" | "model"; content: string }[];
}

export interface ExtractMemoriesResult {
  stored: number;
  deduped: number;
  rejected: number;
}

function parseModelJson(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/** Postgres unique_violation — the partial unique dedupe index fired. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Serializes concurrent extractions for the same subject via a mutual-
 * exclusion lock only — `fn()` does NOT run inside the lock-holding
 * transaction. The advisory lock is acquired on `tx`, but `fn()` (the hash
 * pre-check `findMany`, the semantic-dup `$queryRaw`, `sageMemory.create`,
 * and the embedding `$executeRaw` UPDATE) runs against the outer
 * module-level `prisma` client on its own connection(s), committing
 * independently of — and typically before — the lock-holding transaction
 * itself commits.
 *
 * This is still correct for closing the semantic-dedupe race the lock was
 * built for: the dedupe-check-then-insert sequence in `fn()` is not
 * otherwise atomic (embedTexts is a network call sitting between the
 * SELECT and the INSERT), so two concurrent extractions for the same
 * student could both pass the semantic pre-check before either commits.
 * pg_advisory_xact_lock is transaction-scoped — it releases automatically
 * at commit/rollback — and this function's transaction does not commit
 * until `fn()` has resolved. So a second concurrent caller genuinely
 * blocks here until the first caller's entire `fn()` (including its own
 * writes) has finished, not merely until the first caller reaches some
 * midpoint.
 *
 * Tradeoff: each in-flight extraction now holds one pooled connection for
 * the lock's duration, on top of whatever connections `fn()`'s own queries
 * and the `embedTexts` network call consume from the same pool. This is a
 * connection-amplification cost worth watching if concurrent load
 * increases; not a concern at current alpha-stage, low-traffic volumes.
 */
async function withSubjectLock<T>(subjectId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subjectId})::bigint)`;
      return fn();
    },
    { timeout: 30_000 },
  );
}

export async function extractAndStoreMemories({
  provider,
  studentId,
  conversationId,
  messages,
}: ExtractMemoriesParams): Promise<ExtractMemoriesResult> {
  const empty: ExtractMemoriesResult = { stored: 0, deduped: 0, rejected: 0 };

  try {
    const recent = messages.slice(-12);
    if (recent.length === 0) return empty;

    const raw = await provider.generateStructuredResponse(EXTRACTION_PROMPT, recent);

    // generateStructuredResponse() doesn't return real usageMetadata (unlike
    // the raw REST calls in classify-attachment.ts/file-gist.ts), so this is
    // a chars/4 estimate — the same approximation embedTexts() already uses
    // in src/lib/ai/embeddings.ts. This closes the immediate "invisible to
    // the cost governor" gap; giving every generateStructuredResponse caller
    // (goal/mood/discovery extractors too) real usage metadata is a larger
    // AIProvider interface change, out of scope here.
    const inputChars = EXTRACTION_PROMPT.length + recent.reduce((sum, m) => sum + m.content.length, 0);
    const inputTokens = Math.ceil(inputChars / 4);
    const outputTokens = Math.ceil(raw.length / 4);
    await logLlmCall({
      studentId,
      callSite: "sage_memory_extract",
      model: provider.name,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });

    const { accepted, rejected } = parseExtractionItems(parseModelJson(raw));
    if (accepted.length === 0) return { ...empty, rejected };

    // Pin subject identity and provenance server-side, then re-validate the
    // full candidate through the write gate.
    const candidates: MemoryCandidate[] = accepted
      .slice(0, MAX_MEMORIES_PER_CONVERSATION)
      .map((item) =>
        memoryCandidateSchema.parse({
          ...item,
          subjectType: "student",
          subjectId: studentId,
          sourceType: "conversation",
          sourceId: conversationId,
        }),
      );

    return await withSubjectLock(studentId, async () => {
      const hashes = candidates.map((candidate) => sourceHashFor(candidate));
      const existing = await prisma.sageMemory.findMany({
        where: {
          subjectType: "student",
          subjectId: studentId,
          sourceHash: { in: hashes },
          OR: [{ validTo: null }, { suppressedByStaff: true }],
        },
        select: { sourceHash: true },
      });
      const existingHashes = new Set(existing.map((row) => row.sourceHash));

      const fresh = candidates.filter((_, i) => !existingHashes.has(hashes[i]));
      let deduped = candidates.length - fresh.length;
      if (fresh.length === 0) return { stored: 0, deduped, rejected };

      const vectors = await embedTexts(
        fresh.map((candidate) => candidate.content),
        {
          taskType: "RETRIEVAL_DOCUMENT",
          usage: { studentId, callSite: "sage_memory_extract" },
        },
      );

      let stored = 0;
      const insertedVectors: number[][] = [];
      for (let i = 0; i < fresh.length; i++) {
        const candidate = fresh[i];

        // Semantic dedupe layer 1: rephrased versions of facts already in the
        // DB (the hash layer only catches near-verbatim restatements).
        const dupDistance = getDupDistance();
        const vectorLiteral = toVectorLiteral(vectors[i]);
        const semanticDup = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "visionquest"."SageMemory"
          WHERE "subjectType" = ${candidate.subjectType}
            AND "subjectId" = ${candidate.subjectId}
            AND ("validTo" IS NULL OR "suppressedByStaff" = true)
            AND embedding IS NOT NULL
            AND (embedding <=> ${vectorLiteral}::vector(768)) <= ${dupDistance}
          LIMIT 1
        `;
        if (semanticDup.length > 0) {
          deduped++;
          continue;
        }

        // Semantic dedupe layer 2: near-duplicates within this same batch
        // (the model sometimes emits the same fact twice in one response).
        if (insertedVectors.some((vector) => cosineDistance(vector, vectors[i]) <= dupDistance)) {
          deduped++;
          continue;
        }

        try {
          const row = await prisma.sageMemory.create({
            data: {
              subjectType: candidate.subjectType,
              subjectId: candidate.subjectId,
              kind: candidate.kind,
              content: candidate.content,
              category: candidate.category,
              confidence: candidate.confidence,
              sourceType: candidate.sourceType,
              sourceId: candidate.sourceId,
              sourceHash: sourceHashFor(candidate),
            },
            select: { id: true },
          });
          await prisma.$executeRaw`
            UPDATE "visionquest"."SageMemory"
            SET embedding = ${vectorLiteral}::vector(768)
            WHERE id = ${row.id}
          `;
          insertedVectors.push(vectors[i]);
          stored++;
        } catch (error) {
          if (isUniqueViolation(error)) {
            deduped++; // raced with a concurrent extraction — index did its job
          } else {
            throw error;
          }
        }
      }

      return { stored, deduped, rejected };
    });
  } catch (error) {
    logger.error("Memory extraction failed (non-fatal)", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
