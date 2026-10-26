import { NextResponse } from "next/server";

import { badRequest, forbidden, withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import {
  ConnectionError,
  connectionOwner,
  sendConnection,
} from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";

/**
 * POST /api/teacher/connect/connections/[id]/send — Match & Connect Task 4.3.
 *
 * The instructor is the sender of record (design spec §10: "Sage proposes and
 * drafts, humans send"). Every substantive check lives in `sendConnection` so
 * one code path decides whether a packet may leave the program: student
 * approval, live consent, do-not-contact, a contact with an email, and the
 * fail-closed per-employer limit.
 *
 * This handler adds only what needs a session: the student must be one this
 * instructor manages, and Connect must be on for their class.
 *
 * The response never carries the token — it exists exactly once, in the email.
 */
export const POST = withTeacherAuth(
  async (session, _req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    const ownerId = await connectionOwner(id);
    if (!ownerId) {
      // Same 404 whether it does not exist or belongs to another instructor's
      // student: this route must not be an existence oracle on connection ids.
      return NextResponse.json({ error: "That connection wasn't found." }, { status: 404 });
    }

    const managed = await listManagedStudentIds(session);
    if (!managed.includes(ownerId)) {
      throw forbidden("That student isn't in your classes.");
    }
    if (!(await isConnectEnabledForStudent(ownerId))) {
      throw badRequest("Connect isn't turned on for that student's class yet.");
    }

    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl) {
      // Without it the email would carry a relative link nobody can open.
      return NextResponse.json(
        { error: "The program's web address isn't set up, so nothing was sent." },
        { status: 503 },
      );
    }

    try {
      const result = await sendConnection(id, {
        senderId: session.id,
        senderRole: session.role,
        senderName: session.displayName || "Your SPOKES instructor",
        programName: process.env.PROGRAM_NAME || "SPOKES",
        programEmail: process.env.SMTP_FROM || "",
        baseUrl,
      });
      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ConnectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
);
