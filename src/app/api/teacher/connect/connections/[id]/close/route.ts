import { NextResponse } from "next/server";
import { z } from "zod";

import { forbidden, withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import { ConnectionError, closeConnection } from "@/lib/connect/connections";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/teacher/connect/connections/[id]/close — the instructor closes an
 * introduction with a reason (Task 4.5).
 *
 * The reason is required: a closed connection with no explanation tells the
 * student nothing, and they are notified of the close.
 */
const closeSchema = z
  .object({
    reason: z.string().trim().min(1, "Say why you are closing this.").max(500),
  })
  .strict();

export const POST = withTeacherAuth(
  async (session, req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const { reason } = await parseBody(req, closeSchema);

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { studentId: true },
    });
    if (!connection) {
      return NextResponse.json({ error: "That connection wasn't found." }, { status: 404 });
    }

    const managed = await listManagedStudentIds(session);
    if (!managed.includes(connection.studentId)) {
      throw forbidden("That student isn't in your classes.");
    }

    try {
      await closeConnection(id, { id: session.id, role: session.role }, reason);
      return NextResponse.json({ success: true, data: { id, status: "closed" } });
    } catch (error) {
      if (error instanceof ConnectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
);
