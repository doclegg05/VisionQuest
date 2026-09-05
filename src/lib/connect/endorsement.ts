// =============================================================================
// Drafting the instructor endorsement — the model call.
//
// FERPA routing: `sensitivity: "student_record"` and the new `draft_endorsement`
// AiTask, classified into the `draft` role (src/lib/ai/roles.ts). The prompt
// carries verified facts about one named student, so unlike explain_job it is
// student-derived text from end to end — this is exactly the content the
// local-only routing policy exists for.
//
// Every exit logs an AI audit event (routed, then completed or failed): the
// accountability report reads AuditLog, and a student_record call that skips
// it is invisible to the FERPA review precisely where the review matters.
//
// The draft is REFUSED, never trimmed, when it asserts anything the facts do
// not support. An instructor edits it before it can be sent; nothing here is
// authoritative on its own.
// =============================================================================

import {
  getProviderClass,
  logAiAuditEvent,
  policyDecisionForProvider,
} from "@/lib/ai/audit";
import { resolveAiProvider } from "@/lib/ai/provider";
import { withUsageLogging } from "@/lib/llm-usage";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

import {
  MAX_ENDORSEMENT_CHARS,
  findUngroundedSentences,
  type EndorsementFacts,
} from "./endorsement-shared";

export * from "./endorsement-shared";

const SYSTEM_PROMPT = `You write one short paragraph a teacher will send to an employer about a student.

Rules:
- Use ONLY the facts between the markers. Never add an employer, a job, a date, a skill, or a credential that is not there.
- Three sentences at most. Short words. Short sentences.
- Say what the student did and what they are ready for. Do not promise anything about the future.
- Do not mention money, benefits, housing, health, family, or any barrier.
- Write it as the teacher, in plain language a sixth grader can read.

Return the paragraph and nothing else.`;

export type EndorsementResult =
  | { status: "ok"; text: string }
  | {
      status: "refused";
      reason: "empty" | "ungrounded" | "unavailable" | "cloud_blocked";
    };

function renderFacts(studentName: string, facts: EndorsementFacts): string {
  const lines = [
    "[GROUNDING_DATA_START]",
    `Student: ${sanitizeForPrompt(studentName)}`,
    `Cards a teacher checked: ${
      facts.verifiedCertifications.map((value) => sanitizeForPrompt(value)).join(", ") ||
      "none yet"
    }`,
    `Skills from their own resume: ${
      facts.skills.map((value) => sanitizeForPrompt(value)).join(", ") || "none listed"
    }`,
    `Places they have worked: ${
      facts.employers.map((value) => sanitizeForPrompt(value)).join(", ") || "none listed"
    }`,
    `Attendance: ${facts.attendanceSummary ? sanitizeForPrompt(facts.attendanceSummary) : "not recorded"}`,
    `Teacher's notes: ${facts.instructorNotes ? sanitizeForPrompt(facts.instructorNotes) : "none"}`,
    "[GROUNDING_DATA_END]",
  ];
  return lines.join("\n");
}

/**
 * Draft an endorsement from verified facts.
 *
 * `studentId` is the FERPA actor for routing and audit; the returned text is a
 * DRAFT the instructor edits and approves. A refusal is a normal outcome and
 * the console shows an empty box with the reason rather than a broken page.
 */
export async function draftEndorsement(
  studentId: string,
  studentName: string,
  facts: EndorsementFacts,
  /** The instructor asking for the draft. They are the ACTOR on the audit row. */
  actor: { id: string; role: string },
): Promise<EndorsementResult> {
  const grounding = renderFacts(studentName, facts);

  const baseProvider = await resolveAiProvider({
    studentId,
    task: "draft_endorsement",
    sensitivity: "student_record",
  });

  const providerClass = getProviderClass(baseProvider.name);

  // REFUSE rather than send this to the cloud.
  //
  // `sensitivity: "student_record"` asks for local-only routing, but
  // `resolveAiProvider` documents a deliberate fail-open to the configured
  // cloud provider when the local one is unavailable (VQ-R-002, still an open
  // owner ruling). Most student_record prompts can live with that; this one
  // carries a named student's employers, credentials and attendance in one
  // paragraph written to be sent outside the program, so it is the wrong place
  // to inherit an open question. An instructor writes it by hand instead.
  if (providerClass !== "local") {
    await logAiAuditEvent({
      actorId: actor.id,
      actorRole: actor.role,
      route: "connect.draft_endorsement",
      task: "draft_endorsement",
      sensitivity: "student_record",
      policyDecision: policyDecisionForProvider(baseProvider.name),
      status: "blocked",
      targetId: studentId,
      providerName: baseProvider.name,
      providerClass,
      allowCloud: false,
      reason: "Endorsement drafting is local-only; the resolved provider was not local.",
    });
    return { status: "refused", reason: "cloud_blocked" };
  }

  const auditBase = {
    // The instructor is the actor: they asked for this draft. `studentId` is
    // the routing subject and the `targetId`, not the person who acted — the
    // first cut recorded the student as an actor with the role "teacher",
    // which is wrong in both halves and would have mis-attributed every row in
    // the FERPA accountability report.
    actorId: actor.id,
    actorRole: actor.role,
    targetId: studentId,
    route: "connect.draft_endorsement",
    task: "draft_endorsement" as const,
    sensitivity: "student_record" as const,
    policyDecision: policyDecisionForProvider(baseProvider.name),
    providerName: baseProvider.name,
    providerClass,
    // Always false past this point, and NOT because it is hardcoded: the guard
    // above returns unless `providerClass === "local"`, so a cloud-routed call
    // never reaches here. tsc narrows the type accordingly.
    allowCloud: false,
  };
  await logAiAuditEvent({ ...auditBase, status: "routed", inputChars: grounding.length });

  const provider = withUsageLogging(baseProvider, {
    studentId,
    callSite: "connect.draft_endorsement",
  });

  let draft = "";
  try {
    draft = (
      await provider.generateResponse(SYSTEM_PROMPT, [
        { role: "user", content: `${grounding}\n\nWrite the paragraph now.` },
      ])
    ).trim();
  } catch (error) {
    await logAiAuditEvent({
      ...auditBase,
      status: "failed",
      errorCode: "provider_error",
      reason: String(error).slice(0, 200),
    });
    return { status: "refused", reason: "unavailable" };
  }

  if (draft.length === 0) {
    await logAiAuditEvent({ ...auditBase, status: "failed", errorCode: "empty_reply" });
    return { status: "refused", reason: "empty" };
  }

  const violations = findUngroundedSentences(draft, facts);
  if (violations.length > 0) {
    await logAiAuditEvent({
      ...auditBase,
      status: "failed",
      errorCode: "ungrounded_endorsement",
      reason: `The draft asserted ${violations.length} thing(s) the facts do not support.`,
      outputChars: draft.length,
    });
    return { status: "refused", reason: "ungrounded" };
  }

  await logAiAuditEvent({
    ...auditBase,
    status: "completed",
    inputChars: grounding.length,
    outputChars: draft.length,
  });

  return { status: "ok", text: draft.slice(0, MAX_ENDORSEMENT_CHARS) };
}
