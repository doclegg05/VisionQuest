import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { listManagedStudentIds } from "@/lib/classroom";
import { ConnectionError, proposeConnection } from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";
import { MAX_ENDORSEMENT_CHARS } from "@/lib/connect/endorsement-shared";
import { packetFieldList } from "@/lib/connect/packet-shared";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/teacher/connect/connections — the instructor proposes an
 * introduction (Match & Connect Task 4.3).
 *
 * A proposal sends nothing. It puts a card in front of the student showing the
 * exact packet field list; their tap is the consent event, and only then can
 * the instructor send.
 *
 * The student must be one this instructor manages — checked against
 * `listManagedStudentIds`, not inferred from the request — and Connect must be
 * on for their class. Reading the packet here is a staff read of student data,
 * so it is passed through `recordStudentView`.
 */
const proposeSchema = z
  .object({
    studentId: z.string().cuid("Invalid student ID."),
    jobLeadId: z.string().cuid("Invalid job lead ID."),
    endorsement: z.string().trim().max(MAX_ENDORSEMENT_CHARS).optional(),
  })
  .strict();

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, proposeSchema);

  const managed = await listManagedStudentIds(session);
  if (!managed.includes(input.studentId)) {
    throw forbidden("That student isn't in your classes.");
  }

  if (!(await isConnectEnabledForStudent(input.studentId))) {
    throw badRequest("Connect isn't turned on for that student's class yet.");
  }

  let result;
  try {
    result = await proposeConnection({
      studentId: input.studentId,
      jobLeadId: input.jobLeadId,
      proposedById: session.id,
      proposedVia: "teacher",
      endorsement: input.endorsement,
    });
  } catch (error) {
    if (error instanceof ConnectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await recordStudentView({
    actorId: session.id,
    actorRole: session.role,
    targetStudentId: input.studentId,
    surface: "student_detail",
  });

  return NextResponse.json({
    success: true,
    data: {
      connectionId: result.id,
      status: "proposed",
      fields: packetFieldList(result.packet),
    },
  });
});
