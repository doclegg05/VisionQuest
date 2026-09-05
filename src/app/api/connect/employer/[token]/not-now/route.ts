import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error";
import {
  ConnectionConflictError,
  TransitionNotAllowedError,
} from "@/lib/connect/pipeline";
import {
  EmployerActionError,
  NOT_NOW_REASONS,
  recordNotNow,
} from "@/lib/connect/employer-actions";
import {
  clientIpFrom,
  employerTokenBodySchema,
  resolveEmployerRequest,
} from "@/lib/connect/employer-request";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/connect/employer/[token]/not-now.
 *
 * The reason is a closed list. Only "other" carries a note, capped at 200
 * characters and sanitized: this is free text typed by a stranger on an
 * unauthenticated page, and it is read later by staff and can end up in a
 * report, so it goes through the same boundary every third-party string does.
 */
const bodySchema = employerTokenBodySchema
  .extend({
    reason: z.enum(NOT_NOW_REASONS),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const POST = withErrorHandler(
  async (req: Request, context: { params: Promise<{ token: string }> }) => {
    const { token } = await context.params;
    const body = await parseBody(req, bodySchema);

    const resolved = await resolveEmployerRequest(token, body.token, clientIpFrom(req));
    if (!resolved.ok) return resolved.response;

    try {
      await recordNotNow({
        connectionId: resolved.view.connectionId,
        currentStatus: resolved.view.status,
        reason: body.reason,
        // A note on any other option would be text nobody asked for.
        note: body.reason === "other" && body.note ? sanitizeForPrompt(body.note) : null,
      });
      return NextResponse.json({ success: true, data: { status: "not_now" } });
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
