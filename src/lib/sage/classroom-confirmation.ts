import type { AIProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * JSON contract the LLM returns when asked to inspect a single student turn
 * for a classroom-confirmation beat. Structure mirrors goal-extractor.ts
 * (same extractor pattern — one extra fire-and-forget call per chat turn).
 */
interface ClassroomConfirmationSignal {
  confirmed: boolean;
  confidence: number;
  classroom_mentioned: string | null;
  instructor_mentioned: string | null;
}

export interface ClassroomConfirmationResult {
  confirmed: boolean;
  mismatch: boolean;
  /** True when the extractor fired but no classroom signal was present — no-op. */
  noSignal: boolean;
}

const DETECTION_PROMPT = `You analyze a single turn from a student talking with Sage (an AI mentor). Determine whether the student just identified their classroom (either explicitly, by instructor name, or by day/time). Sage asked them one turn earlier.

Return valid JSON in this exact format:
{
  "confirmed": true | false,
  "confidence": 0.0 to 1.0,
  "classroom_mentioned": "<verbatim classroom name / instructor / day, or null>",
  "instructor_mentioned": "<instructor name only, or null>"
}

Rules:
- confirmed = true only if the student clearly names a classroom, instructor, or a unique day/time that identifies which class they are in.
- confidence reflects how unambiguous the identification is.
- Return both fields when possible; use null for missing ones.
- If the student dodged the question or said nothing about classrooms, return {"confirmed": false, "confidence": 0.0, "classroom_mentioned": null, "instructor_mentioned": null}.`;

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Fire-and-forget classroom-confirmation detector. Called from the chat
 * post-response pipeline whenever `classroomConfirmedAt` is still null.
 *
 * - On clear match against an active enrollment: sets `classroomConfirmedAt = now()`.
 * - On clear mismatch (student named a different class/instructor than their
 *   active enrollment): raises a StudentAlert with type "classroom_mismatch".
 * - If the student has no active enrollment and names a classroom: raises
 *   an intake alert ("classroom_intake_pending") for the teacher to enroll.
 * - No signal or low confidence: no-op. Sage will keep the instruction
 *   injected on the next onboarding turn.
 *
 * Returns a small result object for testing — side effects are the source
 * of truth in production (nothing consumes the return value in the chat
 * route today).
 */
export async function detectAndRecordClassroomConfirmation(
  provider: AIProvider,
  studentId: string,
  userMessage: string,
  sageReply: string,
): Promise<ClassroomConfirmationResult> {
  try {
    const signal = await extractSignal(provider, userMessage, sageReply);

    if (!signal.confirmed || signal.confidence < CONFIDENCE_THRESHOLD) {
      return { confirmed: false, mismatch: false, noSignal: true };
    }

    const enrollment = await prisma.studentClassEnrollment.findFirst({
      where: { studentId, status: "active" },
      orderBy: { enrolledAt: "desc" },
      select: {
        id: true,
        class: { select: { id: true, name: true } },
      },
    });

    if (!enrollment) {
      await raiseAlert(studentId, "classroom_intake_pending", {
        title: "Student confirmed a classroom but has no active enrollment",
        summary: buildIntakeSummary(signal),
      });
      return { confirmed: false, mismatch: true, noSignal: false };
    }

    if (isMatch(signal, enrollment.class.name)) {
      await prisma.student.update({
        where: { id: studentId },
        data: { classroomConfirmedAt: new Date() },
      });
      return { confirmed: true, mismatch: false, noSignal: false };
    }

    await raiseAlert(studentId, "classroom_mismatch", {
      title: "Student named a different classroom than their active enrollment",
      summary: buildMismatchSummary(signal, enrollment.class.name),
      sourceId: enrollment.id,
    });
    return { confirmed: false, mismatch: true, noSignal: false };
  } catch (err) {
    // Never bubble — this is a background extractor. Log and move on.
    logger.error("Classroom confirmation detection failed", {
      studentId,
      error: String(err),
    });
    return { confirmed: false, mismatch: false, noSignal: true };
  }
}

async function extractSignal(
  provider: AIProvider,
  userMessage: string,
  sageReply: string,
): Promise<ClassroomConfirmationSignal> {
  const transcript = [
    { role: "model" as const, content: sageReply },
    { role: "user" as const, content: userMessage },
    {
      role: "user" as const,
      content: "Analyze only the student's most recent message.",
    },
  ];

  const raw = await provider.generateStructuredResponse(DETECTION_PROMPT, transcript);
  const parsed = safeParse(raw);
  return {
    confirmed: parsed?.confirmed === true,
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
    classroom_mentioned:
      typeof parsed?.classroom_mentioned === "string" ? parsed.classroom_mentioned : null,
    instructor_mentioned:
      typeof parsed?.instructor_mentioned === "string" ? parsed.instructor_mentioned : null,
  };
}

function safeParse(raw: string): Partial<ClassroomConfirmationSignal> | null {
  try {
    const result = JSON.parse(raw);
    return typeof result === "object" && result !== null ? result : null;
  } catch {
    return null;
  }
}

function isMatch(signal: ClassroomConfirmationSignal, enrolledClassName: string): boolean {
  const haystack = enrolledClassName.toLowerCase();
  const mentions = [signal.classroom_mentioned, signal.instructor_mentioned]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.toLowerCase());

  if (mentions.length === 0) return false;

  return mentions.some((mention) => {
    if (haystack.includes(mention) || mention.includes(haystack)) return true;
    // Token-level overlap: enrollment name "Mrs. Thompson Monday AM" and
    // student's "Thompson class" should match via shared tokens.
    const mentionTokens = tokenize(mention);
    const haystackTokens = new Set(tokenize(haystack));
    const shared = mentionTokens.filter((t) => haystackTokens.has(t));
    return shared.length >= Math.min(2, mentionTokens.length);
  });
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function buildIntakeSummary(signal: ClassroomConfirmationSignal): string {
  const parts = [
    "The student told Sage they are in a classroom, but they don't have an active enrollment yet.",
    `Stated classroom: ${signal.classroom_mentioned ?? "(unspecified)"}.`,
    `Stated instructor: ${signal.instructor_mentioned ?? "(unspecified)"}.`,
    "Please enroll the student in the correct class so Sage can confirm their program.",
  ];
  return parts.join(" ");
}

function buildMismatchSummary(
  signal: ClassroomConfirmationSignal,
  enrolledClassName: string,
): string {
  const parts = [
    `The student is enrolled in "${enrolledClassName}" but told Sage they are in a different classroom.`,
    `Stated classroom: ${signal.classroom_mentioned ?? "(unspecified)"}.`,
    `Stated instructor: ${signal.instructor_mentioned ?? "(unspecified)"}.`,
    "Please confirm whether the enrollment is correct.",
  ];
  return parts.join(" ");
}

async function raiseAlert(
  studentId: string,
  type: "classroom_mismatch" | "classroom_intake_pending",
  params: { title: string; summary: string; sourceId?: string },
): Promise<void> {
  const alertKey = `${type}:${studentId}`;
  try {
    await prisma.studentAlert.upsert({
      where: { alertKey },
      update: {
        status: "open",
        title: params.title,
        summary: params.summary,
        sourceType: "classroom_confirmation",
        sourceId: params.sourceId ?? null,
        detectedAt: new Date(),
        resolvedAt: null,
      },
      create: {
        studentId,
        alertKey,
        type,
        severity: "medium",
        status: "open",
        title: params.title,
        summary: params.summary,
        sourceType: "classroom_confirmation",
        sourceId: params.sourceId ?? null,
      },
    });
  } catch (err) {
    logger.error("Failed to raise classroom-confirmation alert", {
      studentId,
      type,
      error: String(err),
    });
  }
}
