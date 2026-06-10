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
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  sourceHashFor,
  type MemoryCandidate,
} from "./schema";

const MAX_MEMORIES_PER_CONVERSATION = 5;

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

    const hashes = candidates.map((candidate) => sourceHashFor(candidate));
    const existing = await prisma.sageMemory.findMany({
      where: {
        subjectType: "student",
        subjectId: studentId,
        validTo: null,
        sourceHash: { in: hashes },
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
    for (let i = 0; i < fresh.length; i++) {
      const candidate = fresh[i];
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
          SET embedding = ${toVectorLiteral(vectors[i])}::vector(768)
          WHERE id = ${row.id}
        `;
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
  } catch (error) {
    logger.error("Memory extraction failed (non-fatal)", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
