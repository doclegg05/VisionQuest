import { NextResponse } from "next/server";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { provisionIntakeStudent } from "@/lib/intake/provision";
import { getSession } from "@/lib/auth";
import { isStaffRole, withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { logger } from "@/lib/logger";

/**
 * POST /api/intake/webhook — the staff-authenticated intake door.
 *
 * Behind a bearer secret (Power Automate / an external form) or a staff
 * session, so unlike the public form this caller may name a class, may refresh
 * an existing student's record, and is handed the new account's one-time
 * password to give the student in person. It is still an API boundary: a
 * driver error is logged, not returned (review finding M4).
 */

function isWebhookAuthorized(req: Request): boolean {
  const secret = process.env.INTAKE_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * A Prisma error's `code` (P2002, P2003, …) without its `message`, which
 * quotes the failing query's arguments — the student's own name and email
 * (.claude/rules/security.md, Data Privacy).
 */
function describePrismaCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export const POST = withErrorHandler(async (req: Request) => {
  // Check authorization via Bearer token (Power Automate / External Form)
  const hasWebhookAuth = isWebhookAuthorized(req);

  // Or check if invoked by a logged-in staff member from internal UI
  let hasStaffAuth = false;
  if (!hasWebhookAuth) {
    const session = await getSession();
    if (session && isStaffRole(session.role)) {
      hasStaffAuth = true;
    }
  }

  if (!hasWebhookAuth && !hasStaffAuth) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing webhook secret." },
      { status: 401 },
    );
  }

  // parseBody throws ApiError(400) with the first Zod issue's message, which
  // withErrorHandler renders. Zod messages are about the caller's own payload,
  // never about the database.
  const payload = await parseBody(req, intakePayloadSchema);

  try {
    const result = await provisionIntakeStudent(payload, { source: "staff" });

    if (result.outcome === "duplicate_pending_review") {
      // Unreachable from this door — an existing match on the staff path
      // returns "updated" — but the union is exhaustive by design, so a future
      // outcome cannot fall through into an account-shaped response.
      return NextResponse.json({ success: true, status: "pending_review" }, { status: 202 });
    }

    return NextResponse.json(
      {
        success: true,
        student: {
          id: result.studentDbId,
          studentId: result.studentId,
          displayName: result.displayName,
          isExisting: result.outcome === "updated",
        },
        // Shown once to the authenticated caller so staff can hand the
        // credential to the student out of band. Nothing stores the plaintext,
        // so a lost password is reissued through
        // /api/teacher/students/[id]/reset-password rather than recovered.
        credentials:
          result.outcome === "provisioned" && result.temporaryPassword
            ? {
                username: result.studentId,
                temporaryPassword: result.temporaryPassword,
                mustChangePassword: true,
              }
            : null,
        enrollment: {
          classId: result.classId,
          className: result.className,
        },
        orientation: {
          initialized: result.orientationInitialized,
          packetStorageKey: result.pdfStorageKey ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    logger.error("Automated intake error", {
      alert: "intake_provision_failed",
      errorName: error instanceof Error ? error.name : "unknown",
      code: describePrismaCode(error),
    });

    return NextResponse.json(
      { error: "Failed to provision intake student." },
      { status: 500 },
    );
  }
});
