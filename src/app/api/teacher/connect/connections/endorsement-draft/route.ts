import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { listManagedStudentIds } from "@/lib/classroom";
import { endorsementFactsFor } from "@/lib/connect/connections";
import { draftEndorsement } from "@/lib/connect/endorsement";
import { MAX_ENDORSEMENT_CHARS } from "@/lib/connect/endorsement-shared";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/teacher/connect/connections/endorsement-draft — "Draft with Sage".
 *
 * Returns a DRAFT the instructor edits and then chooses to include; nothing
 * here writes a Connection. The draft is refused outright — never trimmed — if
 * it asserts anything the verified facts do not support, because a fluent
 * paragraph that quietly dropped its worst sentence is harder for an instructor
 * to notice than an empty box.
 *
 * FERPA gate: this prompt carries one named student's certifications,
 * employers and attendance, so it must not reach a cloud provider. The task is
 * `student_record`, but `resolveAiProvider` documents a fail-open to cloud when
 * the local provider is unavailable (VQ-R-002) — so the refusal is here rather
 * than trusting the routing to hold. If the resolved provider is not local,
 * the instructor writes the paragraph themselves.
 */
const draftSchema = z
  .object({
    studentId: z.string().cuid("Invalid student ID."),
    /** Anything the instructor wants the draft to be able to say. */
    instructorNotes: z.string().trim().max(MAX_ENDORSEMENT_CHARS).optional(),
  })
  .strict();

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, draftSchema);

  const managed = await listManagedStudentIds(session);
  if (!managed.includes(input.studentId)) {
    throw forbidden("That student isn't in your classes.");
  }

  const facts = await endorsementFactsFor(input.studentId, input.instructorNotes ?? null);
  if (!facts) throw badRequest("That student wasn't found.");

  await recordStudentView({
    actorId: session.id,
    actorRole: session.role,
    targetStudentId: input.studentId,
    surface: "student_detail",
  });

  const result = await draftEndorsement(input.studentId, facts.displayName, facts.facts, {
    id: session.id,
    role: session.role,
  });

  if (result.status === "refused") {
    const reason =
      result.reason === "ungrounded"
        ? "Sage wrote something the records don't back up, so it was thrown away. Please write it yourself."
        : result.reason === "cloud_blocked"
          ? "Sage can draft this only when the local AI is on."
          : "Sage couldn't write a draft just now. Please write it yourself.";
    return NextResponse.json({ success: true, data: { draft: "", reason } });
  }

  return NextResponse.json({ success: true, data: { draft: result.text, reason: null } });
});
