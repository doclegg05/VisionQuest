import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error";
import { EmployerActionError, recordInterested } from "@/lib/connect/employer-actions";
import {
  contactForConnection,
  employerTokenBodySchema,
  resolveEmployerRequest,
} from "@/lib/connect/employer-request";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/connect/employer/[token]/interested — the employer picks a time.
 *
 * No auth: the token IS the authorization, and there is no account behind it.
 * The origin check in middleware still applies, and the token must also appear
 * in the body (see resolveEmployerRequest).
 */
const bodySchema = employerTokenBodySchema
  .extend({ startsAt: z.string().datetime("Pick one of the times shown.") })
  .strict();

export const POST = withErrorHandler(
  async (req: Request, context: { params: Promise<{ token: string }> }) => {
    const { token } = await context.params;
    const body = await parseBody(req, bodySchema);

    const resolved = await resolveEmployerRequest(token, body.token);
    if (!resolved.ok) return resolved.response;

    const contact = await contactForConnection(resolved.view.connectionId);

    try {
      const result = await recordInterested({
        connectionId: resolved.view.connectionId,
        currentStatus: resolved.view.status,
        startsAt: body.startsAt,
        contactName: contact?.name ?? "Employer contact",
        contactEmail: contact?.email ?? "",
      });
      return NextResponse.json({
        success: true,
        data: { status: "interview_scheduled", startsAt: result.startsAt },
      });
    } catch (error) {
      if (error instanceof EmployerActionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      // A transition that is no longer legal (somebody withdrew, or a second
      // tab already answered) is a conflict, never a 500.
      return NextResponse.json(
        { error: "That link is no longer active." },
        { status: 409 },
      );
    }
  },
);
