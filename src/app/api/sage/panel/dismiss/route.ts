import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, notFound } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { dismissPanel } from "@/lib/sage/panel-data";

const dismissSchema = z.object({ panelId: z.string().cuid() });

/**
 * POST /api/sage/panel/dismiss — hide today's Sage panel.
 * Students dismiss their own; staff may dismiss for a managed student
 * (ownership enforced in dismissPanel). 404 on any panel the caller
 * has no claim to — existence is never confirmed cross-student.
 */
export const POST = withAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, dismissSchema);
  const dismissed = await dismissPanel(body.panelId, session);
  if (!dismissed) {
    throw notFound("Panel not found.");
  }
  return NextResponse.json({ success: true, data: { status: "dismissed" } });
});
