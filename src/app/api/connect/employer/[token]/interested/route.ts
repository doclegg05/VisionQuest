import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error";
import {
  ConnectionConflictError,
  TransitionNotAllowedError,
} from "@/lib/connect/pipeline";
import { EmployerActionError, recordInterested } from "@/lib/connect/employer-actions";
import { tokenContactFor } from "@/lib/connect/employer-link";
import {
  clientIpFrom,
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

    const resolved = await resolveEmployerRequest(token, body.token, clientIpFrom(req));
    if (!resolved.ok) return resolved.response;

    // The contact the TOKEN was minted for, not the lead's current contact: a
    // lead whose contact changed after the packet went out must not put the new
    // person on an appointment the old one booked.
    const contact = await tokenContactFor(resolved.view.connectionId);

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
      // A transition that is no longer legal, or a row that moved under us, is
      // a conflict. Anything ELSE is a programming error and must reach
      // withErrorHandler as a 500 — the first cut caught everything here and
      // reported real bugs to the employer as "This link is no longer active",
      // which is both wrong and unreportable.
      if (
        error instanceof ConnectionConflictError ||
        error instanceof TransitionNotAllowedError
      ) {
        return NextResponse.json(
          { error: "That link is no longer active." },
          { status: 409 },
        );
      }
      throw error;
    }
  },
);
