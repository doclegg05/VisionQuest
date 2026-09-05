import { NextResponse } from "next/server";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit";
import {
  createContactSchema,
  createEmployerContact,
  getEmployer,
} from "@/lib/connect/employers";
import { parseBody } from "@/lib/schemas";

/**
 * Add a contact to one employer (Match & Connect Task 3.2).
 *
 * Staff-only, and students never read this table at all — the RLS policy on
 * EmployerContact has no student branch, because these rows hold a named
 * person's work email and phone.
 *
 * The audit line records that a contact was added and to which employer. It
 * deliberately does NOT record the contact's email or phone: the audit log
 * captures who did what, not the payload (.claude/rules/security.md).
 */

export const POST = withTeacherAuth(
  async (session, req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;

    // A path parameter is request input like any other (.claude/rules/
    // security.md: validate IDs with z.string().cuid()). Without this, a
    // malformed id reaches Prisma and comes back as a driver error.
    const parsed = z.string().cuid("Invalid employer ID.").safeParse(rawId);
    if (!parsed.success) throw badRequest("Invalid employer ID.");
    const employerId = parsed.data;

    // Existence is checked through the caller's own RLS context, so a session
    // that cannot see the employer gets "not found" rather than a foreign-key
    // error naming the table.
    const employer = await getEmployer(employerId);
    if (!employer) throw notFound("That employer wasn't found.");

    const input = await parseBody(req, createContactSchema);
    const contact = await createEmployerContact(employerId, input);

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "connect.employer_contact.created",
      targetType: "employer_contact",
      targetId: contact.id,
      summary: `Added a contact at "${employer.name}".`,
      metadata: { employerId },
    });

    return NextResponse.json({ contact });
  },
);
