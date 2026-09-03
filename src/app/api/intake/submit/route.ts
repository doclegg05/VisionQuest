import { NextRequest, NextResponse } from "next/server";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { provisionIntakeStudent } from "@/lib/intake/provision";
import { setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`intake:submit:${ip}`, 15, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many intake submissions from this network. Please try again in a few minutes." },
      { status: 429 },
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
        error: "Validation failed. Please check required fields.",
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
    const tempPassword = `Spokes${new Date().getFullYear()}!`;

    // Automatically establish a session for the student so they can immediately
    // enter the portal without re-typing their initial password on Day 1.
    try {
      await setSessionCookie(result.studentDbId, "student", 0);
    } catch {
      // If cookie cannot be set (e.g., in non-browser context), student still has credentials displayed
    }

    return NextResponse.json(
      {
        success: true,
        student: {
          id: result.studentDbId,
          studentId: result.studentId,
          displayName: result.displayName,
          isExisting: result.isExisting,
        },
        credentials: {
          username: result.studentId,
          temporaryPassword: tempPassword,
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
    logger.error("Public intake submission failed", {
      alert: "intake_submit_error",
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: "We could not complete your enrollment at this moment. Please check with your instructor.",
        message: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
