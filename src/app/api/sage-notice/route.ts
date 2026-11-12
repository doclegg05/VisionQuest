import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { recordSageNoticeAcknowledgement } from "@/lib/consent";
import { SAGE_NOTICE_VERSION } from "@/lib/about-sage/notice";

/**
 * POST /api/sage-notice { version } — the signed-in student says they read
 * the Sage notice (H6).
 *
 * The student is always the session: the body is strict, so a `studentId`
 * in it is refused rather than ignored. The version must be the current one,
 * so a screen left open from an older notice cannot answer for a newer one.
 * Staff are never asked, so they cannot record it either.
 */
const bodySchema = z
  .object({
    version: z.literal(SAGE_NOTICE_VERSION, {
      error: "This notice has changed. Please reload the page and read it again.",
    }),
  })
  .strict();

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "student") throw forbidden("Only students are asked to read this notice.");

  const { version } = await parseBody(req, bodySchema);
  await recordSageNoticeAcknowledgement(session.id, version);

  return NextResponse.json({ success: true, data: { version, acknowledged: true } });
});
