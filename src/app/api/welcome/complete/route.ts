import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { recordWelcomeCompleted } from "@/lib/progression/welcome-completion";
import { WELCOME_PATHS } from "@/lib/progression/welcome-routing";

/**
 * POST /api/welcome/complete
 *
 * Records that the student finished the welcome flow by choosing one of its
 * three paths. Without this fact a day-1 student who picks "Complete
 * Onboarding Paperwork" or "View My Employment Journey Map" is bounced
 * straight back to /welcome by the dashboard's day-1 redirect.
 *
 * Idempotent: the ledger row is unique per student, so a repeat click, a
 * double submit, or a retry after a network failure records nothing new.
 *
 * A genuine ledger-write failure is NOT swallowed into a 200 here:
 * recordWelcomeCompleted opts into awardEvent's rethrowOnFailure, so a real
 * failure propagates out of this handler and withAuth's error handler turns
 * it into a 500 (never the raw Prisma error — see src/lib/api-error.ts).
 */
const welcomeCompleteSchema = z.object({
  // Derived from the same constant the welcome flow renders its cards from,
  // so the accepted vocabulary cannot drift from what the client can send.
  path: z.enum(WELCOME_PATHS),
});

export const POST = withAuth(async (session, req: NextRequest) => {
  // withAuth only checks for a valid session, not role — bare withAuth would
  // admit a staff session onto a student-only completion record. Same gate
  // as GET /api/student/memories.
  if (session.role !== "student") {
    throw forbidden("Only students can complete their own welcome flow.");
  }
  const { path } = await parseBody(req, welcomeCompleteSchema);
  await recordWelcomeCompleted(session.id, path);
  return NextResponse.json({ success: true });
});
