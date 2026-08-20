/**
 * Shared write path for every Sage memory producer.
 *
 * Extracted from extract.ts when a second producer (staff-chat extraction)
 * and a third (deterministic operation memories) arrived: subject identity,
 * locking, dedupe, and the embedding write are identical for all three, and
 * only the *candidate source* differs. Keeping one store means a dedupe or
 * provenance fix lands for every producer at once.
 *
 * ADD-only: nothing here mutates or deletes an existing memory — the
 * consolidation cron owns decay/archival.
 *
 * Dedupe is layered:
 *   1. sourceHash pre-check (near-verbatim restatements)
 *   2. embedding-distance probe against stored rows (rephrasings)
 *   3. embedding-distance probe within the same batch
 *   4. the partial unique index SageMemory_subject_sourceHash_active_key as
 *      the race-proof backstop
 * Layers 2 and 3 exist for *model-written* candidates. Deterministic
 * producers opt out via `semanticDedupe: false` (see operation-memory.ts):
 * two different confirmed goals render to similar sentences by construction,
 * and collapsing them would silently drop real events.
 */

import { prisma } from "@/lib/db";
import { embedTexts, toVectorLiteral } from "@/lib/ai/embeddings";
import { getActiveEmbeddingModel } from "@/lib/ai/embedding-provider";
import { sourceHashFor, type MemoryCandidate } from "./schema";

/**
 * Semantic dedupe cutoff: a candidate whose embedding is within this cosine
 * distance of an existing ACTIVE memory is a rephrasing, not a new fact.
 * (0.08 distance ≈ 0.92 similarity.) Overridable via SAGE_MEMORY_DUP_DISTANCE.
 */
const DEFAULT_DUP_DISTANCE = 0.08;

export function getDupDistance(): number {
  const raw = Number.parseFloat(process.env.SAGE_MEMORY_DUP_DISTANCE ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_DUP_DISTANCE;
}

export function cosineDistance(a: number[], b: number[]): number {
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
 * Serializes concurrent writes for the same subject via a mutual-exclusion
 * lock only — `fn()` does NOT run inside the lock-holding transaction. The
 * advisory lock is acquired on `tx`, but `fn()` (the hash pre-check
 * `findMany`, the semantic-dup `$queryRaw`, `sageMemory.create`, and the
 * embedding `$executeRaw` UPDATE) runs against the outer module-level
 * `prisma` client on its own connection(s), committing independently of —
 * and typically before — the lock-holding transaction itself commits.
 *
 * This is still correct for closing the semantic-dedupe race the lock was
 * built for: the dedupe-check-then-insert sequence in `fn()` is not
 * otherwise atomic (embedTexts is a network call sitting between the
 * SELECT and the INSERT), so two concurrent writers for the same subject
 * could both pass the semantic pre-check before either commits.
 * pg_advisory_xact_lock is transaction-scoped — it releases automatically
 * at commit/rollback — and this function's transaction does not commit
 * until `fn()` has resolved. So a second concurrent caller genuinely
 * blocks here until the first caller's entire `fn()` (including its own
 * writes) has finished, not merely until the first caller reaches some
 * midpoint.
 *
 * Tradeoff: each in-flight write now holds one pooled connection for the
 * lock's duration, on top of whatever connections `fn()`'s own queries and
 * the `embedTexts` network call consume from the same pool. This is a
 * connection-amplification cost worth watching if concurrent load
 * increases; not a concern at current alpha-stage, low-traffic volumes.
 */
export async function withSubjectLock<T>(subjectId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subjectId})::bigint)`;
      return fn();
    },
    { timeout: 30_000 },
  );
}

export interface StoreMemoriesResult {
  stored: number;
  deduped: number;
}

export interface StoreMemoriesOptions {
  /** Attribution for the embedding call's token accounting. */
  usage: { studentId: string; callSite: string };
  /**
   * Run the embedding-distance dedupe probes (layers 2 and 3). Model-written
   * candidates want this; deterministic templates do not — see module header.
   */
  semanticDedupe: boolean;
}

/**
 * Persist validated candidates for ONE subject. Every candidate must share
 * the same subjectType/subjectId — the advisory lock and the hash pre-check
 * are both scoped to that single subject.
 *
 * Throws only on unexpected DB failure; callers decide whether that is fatal
 * (it never is, in practice — memory is best-effort everywhere).
 */
export async function storeMemoryCandidates(
  candidates: MemoryCandidate[],
  { usage, semanticDedupe }: StoreMemoriesOptions,
): Promise<StoreMemoriesResult> {
  if (candidates.length === 0) return { stored: 0, deduped: 0 };

  const { subjectType, subjectId } = candidates[0];
  if (candidates.some((c) => c.subjectType !== subjectType || c.subjectId !== subjectId)) {
    throw new Error("storeMemoryCandidates requires every candidate to share one subject");
  }

  return withSubjectLock(subjectId, async () => {
    const hashes = candidates.map((candidate) => sourceHashFor(candidate));
    const existing = await prisma.sageMemory.findMany({
      where: {
        subjectType,
        subjectId,
        sourceHash: { in: hashes },
        OR: [{ validTo: null }, { suppressedByStaff: true }],
      },
      select: { sourceHash: true },
    });
    const existingHashes = new Set(existing.map((row) => row.sourceHash));

    const fresh = candidates.filter((_, i) => !existingHashes.has(hashes[i]));
    let deduped = candidates.length - fresh.length;
    if (fresh.length === 0) return { stored: 0, deduped };

    const vectors = await embedTexts(
      fresh.map((candidate) => candidate.content),
      { taskType: "RETRIEVAL_DOCUMENT", usage },
    );
    // Provenance for the memory guard: same-model invariant as embedTexts above.
    const activeModel = await getActiveEmbeddingModel();
    const dupDistance = getDupDistance();

    let stored = 0;
    const insertedVectors: number[][] = [];
    for (let i = 0; i < fresh.length; i++) {
      const candidate = fresh[i];
      const vectorLiteral = toVectorLiteral(vectors[i]);

      if (semanticDedupe) {
        // Layer 2: rephrased versions of facts already in the DB (the hash
        // layer only catches near-verbatim restatements).
        const semanticDup = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "visionquest"."SageMemory"
          WHERE "subjectType" = ${candidate.subjectType}
            AND "subjectId" = ${candidate.subjectId}
            AND ("validTo" IS NULL OR "suppressedByStaff" = true)
            AND embedding IS NOT NULL
            AND "embeddingModel" = ${activeModel}
            AND (embedding <=> ${vectorLiteral}::vector(768)) <= ${dupDistance}
          LIMIT 1
        `;
        if (semanticDup.length > 0) {
          deduped++;
          continue;
        }

        // Layer 3: near-duplicates within this same batch (the model
        // sometimes emits the same fact twice in one response).
        if (insertedVectors.some((vector) => cosineDistance(vector, vectors[i]) <= dupDistance)) {
          deduped++;
          continue;
        }
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
          SET embedding = ${vectorLiteral}::vector(768),
              "embeddingModel" = ${activeModel}
          WHERE id = ${row.id}
        `;
        insertedVectors.push(vectors[i]);
        stored++;
      } catch (error) {
        if (isUniqueViolation(error)) {
          deduped++; // raced with a concurrent write — index did its job
        } else {
          throw error;
        }
      }
    }

    return { stored, deduped };
  });
}
