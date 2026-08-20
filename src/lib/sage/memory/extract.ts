/**
 * Post-response memory extraction for STUDENT chat (Phase 2, Mem0 ADD-only
 * pattern).
 *
 * Runs fire-and-forget after the SSE stream completes (wired in
 * src/lib/chat/post-response.ts). The provider is resolved by the caller via
 * resolveAiProvider(), so FERPA routing (student_record → local-only policy)
 * is inherited from the chat pipeline, never re-decided here.
 *
 * The write path (locking, dedupe, embeddings) lives in ./store.ts and is
 * shared with the staff-chat extractor (./staff-extract.ts) and the
 * deterministic operation-memory writer (./operation-memory.ts).
 *
 * Never throws to the caller: a failed extraction must not surface as a chat
 * error.
 */

import { logLlmCall } from "@/lib/llm-usage";
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  type MemoryCandidate,
} from "./schema";
import { storeMemoryCandidates } from "./store";

export const MAX_MEMORIES_PER_CONVERSATION = 5;

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

If your output format requires a JSON object rather than an array, return {"memories": [ ...the same elements... ]} — never a single bare element.

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

export function parseModelJson(raw: string): unknown {
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

/**
 * Chars/4 token estimate for a generateStructuredResponse call.
 *
 * generateStructuredResponse() doesn't return real usageMetadata (unlike the
 * raw REST calls in classify-attachment.ts/file-gist.ts), so this is the same
 * approximation embedTexts() already uses in src/lib/ai/embeddings.ts. It
 * closes the "invisible to the cost governor" gap; giving every
 * generateStructuredResponse caller real usage metadata is a larger
 * AIProvider interface change, out of scope here.
 */
export async function logEstimatedExtractionCost(params: {
  subjectId: string;
  callSite: string;
  providerName: string;
  prompt: string;
  messages: { content: string }[];
  raw: string;
}): Promise<void> {
  const inputChars =
    params.prompt.length + params.messages.reduce((sum, m) => sum + m.content.length, 0);
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(params.raw.length / 4);
  await logLlmCall({
    studentId: params.subjectId,
    callSite: params.callSite,
    model: params.providerName,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });
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

    await logEstimatedExtractionCost({
      subjectId: studentId,
      callSite: "sage_memory_extract",
      providerName: provider.name,
      prompt: EXTRACTION_PROMPT,
      messages: recent,
      raw,
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

    const { stored, deduped } = await storeMemoryCandidates(candidates, {
      usage: { studentId, callSite: "sage_memory_extract" },
      semanticDedupe: true,
    });
    return { stored, deduped, rejected };
  } catch (error) {
    logger.error("Memory extraction failed (non-fatal)", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
