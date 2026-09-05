import { NextResponse } from "next/server";

import { notFound, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import {
  createEmployer,
  createEmployerSchema,
  listEmployers,
  updateEmployer,
  updateEmployerSchema,
} from "@/lib/connect/employers";
import { EMPLOYER_STATUSES } from "@/lib/connect/employers-shared";
import { parseBody } from "@/lib/schemas";
import { z } from "zod";

/**
 * The employer directory (Match & Connect Task 3.2).
 *
 * Staff-only at three layers, deliberately: `withTeacherAuth` rejects the
 * session, the RLS policies admit no student branch, and no student-facing
 * route imports this module. No student data is read here at all — an
 * employer row is program data, not a student record — so there is no
 * `recordStudentView` call, unlike the console's match views.
 *
 * Prisma access lives in src/lib/connect/employers.ts (repo rule: queries in
 * src/lib/, not in route handlers), and every write is audited: an employer's
 * `do_not_contact` status is a promise the program made to a real business.
 */

const listQuerySchema = z.object({ status: z.enum(EMPLOYER_STATUSES).optional() });

export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
  });

  const employers = await listEmployers(parsed.success ? parsed.data : {});
  return NextResponse.json({ employers });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, createEmployerSchema);
  const employer = await createEmployer(input);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.employer.created",
    targetType: "employer",
    targetId: employer.id,
    summary: `Added employer "${employer.name}".`,
  });

  return NextResponse.json({ employer });
});

export const PUT = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, updateEmployerSchema);

  let employer;
  try {
    employer = await updateEmployer(input);
  } catch {
    // The only expected failure is "no such row". Anything else is still
    // swallowed here rather than surfaced: a Prisma error message names the
    // schema, the table and the invocation, none of which belongs in a client
    // response (.claude/rules/security.md).
    throw notFound("That employer wasn't found.");
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.employer.updated",
    targetType: "employer",
    targetId: employer.id,
    summary: `Updated employer "${employer.name}".`,
    metadata: { status: employer.status },
  });

  return NextResponse.json({ employer });
});
