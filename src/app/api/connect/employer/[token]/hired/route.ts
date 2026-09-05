import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error";
import { EmployerActionError, recordHired } from "@/lib/connect/employer-actions";
import { employerTokenBodySchema, resolveEmployerRequest } from "@/lib/connect/employer-request";
import { parseBody } from "@/lib/schemas";

/**
 * POST /api/connect/employer/[token]/hired — the outcome that matters.
 *
 * The wage is bounded rather than free: a typo of $1500/hr would flow straight
 * into the SPOKES record and the grant KPI report, and the program measures
 * placements in hourly wages under about a hundred dollars.
 */
const bodySchema = employerTokenBodySchema
  .extend({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-15."),
    hourlyWage: z.number().min(1, "Enter the hourly pay.").max(200),
  })
  .strict();

export const POST = withErrorHandler(
  async (req: Request, context: { params: Promise<{ token: string }> }) => {
    const { token } = await context.params;
    const body = await parseBody(req, bodySchema);

    const resolved = await resolveEmployerRequest(token, body.token);
    if (!resolved.ok) return resolved.response;

    try {
      await recordHired({
        connectionId: resolved.view.connectionId,
        currentStatus: resolved.view.status,
        startDate: body.startDate,
        hourlyWage: body.hourlyWage,
      });
      return NextResponse.json({ success: true, data: { status: "hired" } });
    } catch (error) {
      if (error instanceof EmployerActionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      // Includes the replay case: a second "Hired" on the same link finds a
      // connection whose token was cleared, so it never reaches here — and if
      // it did, hired → hired is not a legal transition.
      return NextResponse.json({ error: "That link is no longer active." }, { status: 409 });
    }
  },
);
