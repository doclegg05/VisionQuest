/**
 * Durable memory for STAFF chat turns.
 *
 * Sage should learn how an instructor works — how they want answers shaped,
 * when they do their review pass, what their stated constraints are — the same
 * way it learns about a student. It must learn none of that *about* the
 * students in the room: see ./staff-privacy.ts for why teacher-subject rows are
 * held to an absolute no-PII rule rather than a proportional one.
 *
 * Deliberately NOT routed through src/lib/chat/post-response.ts. That pipeline
 * is student-shaped end to end — crisis detection, goal proposals, discovery
 * upserts, mood scoring, review XP, classroom confirmation — and every one of
 * those steps takes a studentId that a teacher account does not have. Rather
 * than thread an `isStaff` flag through five extractors and hope each gate
 * holds, staff chat calls this one function directly from the route. Memory
 * extraction is the only post-response step staff get, and it is impossible to
 * accidentally get the others.
 *
 * Never throws to the caller: a failed extraction must not surface as a chat
 * error.
 */

import { logAiAuditEvent, getProviderClass, policyDecisionForProvider } from "@/lib/ai/audit";
import { rateLimitDaily } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  type MemoryCandidate,
} from "./schema";
import { looksLikeStudentReference } from "./staff-privacy";
import { storeMemoryCandidates } from "./store";
import {
  logEstimatedExtractionCost,
  parseModelJson,
  type ExtractMemoriesResult,
} from "./extract";

const MAX_STAFF_MEMORIES_PER_CONVERSATION = 3;
const DEFAULT_STAFF_EXTRACT_DAILY_LIMIT = 100;

/**
 * Layer 1 of the privacy design (the code guard is layer 2). The prompt is
 * written so the model has no reason to reach for a student fact: it is told
 * what to collect, told the hard rule, and given the return-[] escape hatch
 * for the very common case of a conversation that was entirely about
 * individual students.
 */
const STAFF_EXTRACTION_PROMPT = `You are a memory extractor for Sage, an AI assistant that supports instructors in the SPOKES workforce-development program.

From the conversation, extract up to ${MAX_STAFF_MEMORIES_PER_CONVERSATION} NEW durable facts about THE STAFF MEMBER you are talking with — how they work, not what they are working on.

Include facts like: how they want Sage to answer (length, format, tone, level of detail), their working patterns (when they run their review pass, how they prepare for class, which reports they open first), the tools and routines they rely on, and constraints they have stated (caseload, time available, what they are not allowed to decide).

HARD PRIVACY RULE — this is not student-record storage:
- Never write a fact about a student, named or unnamed.
- Never include any person's name, a student ID, an email address, or a phone number.
- Never include anything a student disclosed, or any personal circumstance of any student.
- If the conversation was only about individual students, return [].

Write each fact as one self-contained sentence starting with an ordinary verb or adverb about the staff member — "Prefers three-bullet answers with the action first.", "Reviews flagged students every Monday before class." Do not start a sentence with a name.

Respond with ONLY a JSON array (no prose). Each element:
{
  "kind": "episodic" | "semantic" | "procedural",
  "content": "One self-contained sentence, max 500 chars.",
  "category": "goal" | "preference" | "circumstance" | "skill" | "coaching" | "progress" | "other",
  "confidence": 0.0-1.0
}

If your output format requires a JSON object rather than an array, return {"memories": [ ...the same elements... ]} — never a single bare element.

Return [] if nothing durable about the staff member was shared.`;

export interface ExtractStaffMemoriesParams {
  provider: AIProvider;
  /** The signed-in staff member. Becomes the memory subject. */
  staffId: string;
  /** Session role, for the audit trail only. */
  staffRole: string;
  conversationId: string;
  messages: { role: "user" | "model"; content: string }[];
}

function memoryEnabled(): boolean {
  return process.env.SAGE_MEMORY_ENABLED?.trim().toLowerCase() !== "false";
}

function staffExtractDailyLimit(): number {
  const raw = Number.parseInt(process.env.SAGE_STAFF_MEMORY_EXTRACT_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STAFF_EXTRACT_DAILY_LIMIT;
}

export async function extractAndStoreStaffMemories({
  provider,
  staffId,
  staffRole,
  conversationId,
  messages,
}: ExtractStaffMemoriesParams): Promise<ExtractMemoriesResult> {
  const empty: ExtractMemoriesResult = { stored: 0, deduped: 0, rejected: 0 };

  try {
    if (!memoryEnabled()) return empty;

    const recent = messages.slice(-12);
    if (recent.length === 0) return empty;

    // Independent daily ceiling, separate from the student extractor's. Staff
    // turns are cheap and infrequent; this is a runaway guard, not a limiter.
    // Fails OPEN — a broken limiter must not silently disable memory — and
    // rateLimitDaily() carries that policy itself: it never throws, and logs
    // when it falls back (see the failure-policy note in @/lib/rate-limit).
    const limit = staffExtractDailyLimit();
    const limiter = await rateLimitDaily(`sage-staff-memory-extract:${staffId}`, limit);
    if (!limiter.success) {
      logger.warn("Staff memory extraction daily limit reached; skipping this turn", {
        conversationId,
        limit,
      });
      return empty;
    }

    const providerClass = getProviderClass(provider.name);
    await logAiAuditEvent({
      actorId: staffId,
      actorRole: staffRole,
      route: "background:chat/staff-memory",
      task: "sage_post_response",
      sensitivity: "staff_entered",
      policyDecision: policyDecisionForProvider(provider.name),
      status: "routed",
      targetId: conversationId,
      providerName: provider.name,
      providerClass,
      allowCloud: providerClass === "cloud",
      inputChars: recent.reduce((sum, m) => sum + m.content.length, 0),
      reason: "Staff-chat memory extraction; teacher-subject facts only, no student content stored.",
    });

    const raw = await provider.generateStructuredResponse(STAFF_EXTRACTION_PROMPT, recent);

    await logEstimatedExtractionCost({
      subjectId: staffId,
      callSite: "sage_staff_memory_extract",
      providerName: provider.name,
      prompt: STAFF_EXTRACTION_PROMPT,
      messages: recent,
      raw,
    });

    const { accepted, rejected: schemaRejected } = parseExtractionItems(parseModelJson(raw));

    // Layer 2: drop anything that reads as student data before it can be
    // written. Rejections are counted, not thrown — the model producing a
    // student fact is an expected outcome of a conversation about students,
    // not an error condition.
    const safe = accepted.filter((item) => !looksLikeStudentReference(item.content));
    const privacyRejected = accepted.length - safe.length;
    if (privacyRejected > 0) {
      logger.info("sage.staff_memory.privacy_rejected", {
        conversationId,
        rejected: privacyRejected,
      });
    }

    const rejected = schemaRejected + privacyRejected;
    if (safe.length === 0) return { ...empty, rejected };

    const candidates: MemoryCandidate[] = safe
      .slice(0, MAX_STAFF_MEMORIES_PER_CONVERSATION)
      .map((item) =>
        memoryCandidateSchema.parse({
          ...item,
          subjectType: "teacher",
          subjectId: staffId,
          sourceType: "conversation",
          sourceId: conversationId,
        }),
      );

    const { stored, deduped } = await storeMemoryCandidates(candidates, {
      usage: { studentId: staffId, callSite: "sage_staff_memory_extract" },
      semanticDedupe: true,
    });
    return { stored, deduped, rejected };
  } catch (error) {
    logger.error("Staff memory extraction failed (non-fatal)", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
