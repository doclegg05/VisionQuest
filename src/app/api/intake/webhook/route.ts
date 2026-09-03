import { timingSafeEqual } from "node:crypto";
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

/**
 * Compare a presented bearer token against the configured one without letting
 * the comparison's duration report how much of the prefix matched. The length
 * check leaks only the length, which a token's format already publishes.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Bearer authentication for the external-form caller.
 *
 * This deliberately does NOT fall back to `CRON_SECRET`. That fallback made
 * the token authenticating every `/api/internal/*` cron endpoint double as the
 * webhook's password, so one leak at an external form vendor would have
 * reached the whole internal job surface — and because `INTAKE_WEBHOOK_SECRET`
 * was declared in no environment file, the fallback was not a fallback, it was
 * the live path.
 *
 * With the fallback gone, an unset secret must fail loudly rather than turn
 * into a silently unusable endpoint, so it refuses and alarms. A staff session
 * is checked separately in the handler and still works: it is an independent,
 * stronger credential that a missing bearer secret does not weaken.
 */
function isWebhookAuthorized(req: Request): boolean {
  const secret = process.env.INTAKE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("INTAKE_WEBHOOK_SECRET is not configured; the intake webhook refuses every bearer caller", {
      alert: "intake_webhook_secret_missing",
    });
    return false;
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  return constantTimeEqual(authHeader, `Bearer ${secret}`);
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
