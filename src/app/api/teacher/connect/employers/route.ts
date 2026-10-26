import { NextResponse } from "next/server";

import { ApiError, badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
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
  // A typo used to fall back to {} and silently return EVERY employer,
  // including the do_not_contact ones a caller asking for "active" was trying
  // to exclude. Widening a result set on a malformed filter is the wrong
  // direction; say what is wrong instead.
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid filter.");
  }

  const employers = await listEmployers(parsed.data);
  return NextResponse.json({ employers });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const input = await parseBody(req, createEmployerSchema);
  // createEmployer turns a duplicate name into a 409 and a non-staff owner
  // into a 400; both are ApiErrors and travel out through withErrorHandler.
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
  } catch (error: unknown) {
    // updateEmployer raises its own ApiErrors (409 on a name collision, 400 on
    // a non-staff owner); those must reach the client as themselves. Anything
    // else becomes a plain 404: a Prisma error message names the schema, the
    // table and the invocation, none of which belongs in a client response
    // (.claude/rules/security.md).
    if (error instanceof ApiError) throw error;
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
