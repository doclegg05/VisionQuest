import { NextResponse } from "next/server";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { provisionIntakeStudent } from "@/lib/intake/provision";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { logger } from "@/lib/logger";

function isWebhookAuthorized(req: Request): boolean {
  const secret = process.env.INTAKE_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = intakePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed.",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await provisionIntakeStudent(parsed.data);

    return NextResponse.json(
      {
        success: true,
        student: {
          id: result.studentDbId,
          studentId: result.studentId,
          displayName: result.displayName,
          isExisting: result.isExisting,
        },
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
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: "Failed to provision intake student.",
        message: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
