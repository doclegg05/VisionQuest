import type { Prisma } from "@prisma/client";
import { extractionTranscript } from "../extraction-transcript";
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
 * Direct chat callers retain non-fatal behavior. Durable workers opt into
 * throwing on failure so an unsuccessful extraction is retried.
 */

import { logAiAuditEvent, getProviderClass, policyDecisionForProvider } from "@/lib/ai/audit";
import { rateLimitDaily } from "@/lib/rate-limit";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  unwrapItemList,
  type ExtractionItem,
  type MemoryCandidate,
} from "./schema";
import { looksLikeStudentReference, STAFF_FACT_SUBJECT } from "./staff-privacy";
import { storeMemoryCandidates } from "./store";
import {
  logEstimatedExtractionCost,
  parseModelJson,
  type ExtractMemoriesResult,
} from "./extract";

const MAX_STAFF_MEMORIES_PER_CONVERSATION = 3;
const DEFAULT_STAFF_EXTRACT_DAILY_LIMIT = 100;

/**
 * Every staff fact opens with STAFF_FACT_SUBJECT, then a lowercase word. The
 * privacy guard reads any capitalized word missing from its allowlist as a
 * name, so a fact that opens with a verb of the model's choosing ("Lacks",
 * "Translates", "Conducts") is dropped as if it named a student. Behind the
 * fixed subject the verb is lowercase and the opener is always "This", which
 * the guard allows. The possessive "This instructor's …" also counts. A fact
 * without the frame, or with a capitalized word after it, is rejected, not
 * repaired, so a model that ignores the instruction fails closed. The frame
 * is stored as written: retrieve.ts runs the guard again at render time, and
 * a stripped "Lacks…" row would fail it. The pattern is built from a fixed
 * constant, never from input.
 */
const STAFF_FACT_FRAME_RE = new RegExp(`^${STAFF_FACT_SUBJECT}(?:['’]s)?\\s+\\p{Ll}`, "u");

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

Start every fact with "${STAFF_FACT_SUBJECT}" followed by a lowercase verb, as one self-contained sentence: "${STAFF_FACT_SUBJECT} prefers three-bullet answers with the action first.", "${STAFF_FACT_SUBJECT} reviews flagged students every Monday before class.", "${STAFF_FACT_SUBJECT} cannot approve placements and routes them to the coordinator." A fact that does not start with "${STAFF_FACT_SUBJECT}" is discarded. Refer to the instructor as "they" or "their", never "he" or "she". Never put a name anywhere in the sentence.

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
  throwOnError?: boolean;
  /** Durable admission already counted this source message, once. */
  dailyLimitReserved?: boolean;
  storeGuard?: <T>(write: (transaction?: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
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

/**
 * Keeps the items that open with STAFF_FACT_SUBJECT and pass the privacy
 * guard (layer 2), which drops anything that reads as student data before it
 * can be written. Rejections are counted and logged, not thrown: the model
 * producing a student fact is an expected outcome of a conversation about
 * students, not an error condition.
 */
function keepFramedStaffSafeItems(
  items: ExtractionItem[],
  conversationId: string,
): { safe: ExtractionItem[]; rejected: number } {
  const framed = items.filter((item) => STAFF_FACT_FRAME_RE.test(item.content));
  const frameRejected = items.length - framed.length;
  if (frameRejected > 0) {
    logger.info("sage.staff_memory.frame_rejected", { conversationId, rejected: frameRejected });
  }

  const safe = framed.filter((item) => !looksLikeStudentReference(item.content));
  const privacyRejected = framed.length - safe.length;
  if (privacyRejected > 0) {
    logger.info("sage.staff_memory.privacy_rejected", { conversationId, rejected: privacyRejected });
  }

  return { safe, rejected: frameRejected + privacyRejected };
}

export async function extractAndStoreStaffMemories({
  provider,
  staffId,
  staffRole,
  conversationId,
  messages,
  throwOnError = false,
  dailyLimitReserved = false,
  storeGuard = async (write) => write(),
}: ExtractStaffMemoriesParams): Promise<ExtractMemoriesResult> {
  const empty: ExtractMemoriesResult = { stored: 0, deduped: 0, rejected: 0 };

  try {
    if (!memoryEnabled()) return empty;

    const recent = messages.slice(-12);
    if (recent.length === 0) return empty;
    const inputMessages = extractionTranscript(recent, "Extract supported staff memories from the preceding conversation according to the system instructions.");

    // Independent daily ceiling, separate from the student extractor's. Staff
    // turns are cheap and infrequent; this is a runaway guard, not a limiter.
    // Fails OPEN — a broken limiter must not silently disable memory — and
    // rateLimitDaily() carries that policy itself: it never throws, and logs
    // when it falls back (see the failure-policy note in @/lib/rate-limit).
    const limit = staffExtractDailyLimit();
    const limiter = dailyLimitReserved ? { success: true } : await rateLimitDaily(`sage-staff-memory-extract:${staffId}`, limit);
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
      inputChars: STAFF_EXTRACTION_PROMPT.length + inputMessages.reduce((sum, m) => sum + m.content.length, 0),
      reason: "Staff-chat memory extraction; teacher-subject facts only, no student content stored.",
    });

    const raw = await provider.generateStructuredResponse(STAFF_EXTRACTION_PROMPT, inputMessages);

    await logEstimatedExtractionCost({
      subjectId: staffId,
      callSite: "sage_staff_memory_extract",
      providerName: provider.name,
      prompt: STAFF_EXTRACTION_PROMPT,
      messages: inputMessages,
      raw,
    });

    const parsed = parseModelJson(raw);
    if (throwOnError && unwrapItemList(parsed) === null) throw new Error("Invalid staff memory extraction JSON");
    const { accepted, rejected: schemaRejected } = parseExtractionItems(parsed);
    const { safe, rejected: filterRejected } = keepFramedStaffSafeItems(accepted, conversationId);

    const rejected = schemaRejected + filterRejected;
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

    const { stored, deduped } = await storeGuard((transaction) => storeMemoryCandidates(candidates, {
      transaction,
      usage: { studentId: staffId, callSite: "sage_staff_memory_extract" },
      semanticDedupe: true,
    }));
    return { stored, deduped, rejected };
  } catch (error) {
    logger.error("Staff memory extraction failed (non-fatal)", {
      conversationId,
      error: errorForLog(error),
    });
    if (throwOnError) throw new Error("Staff memory extraction failed");
    return empty;
  }
}
