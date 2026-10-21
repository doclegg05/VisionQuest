import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-error";
import { tryLogAuditEvent } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
import { ensureDemoClassroom } from "@/lib/demo/bootstrap";
import { isCohortDemoEnabled } from "@/lib/demo/config";
import { DEMO_LIMIT_INSTRUCTOR } from "@/lib/demo/copy";
import { readDemoInstructorSessionVersion } from "@/lib/demo/instructor-session";
import { rateLimit } from "@/lib/rate-limit";

const SIGN_INS_PER_NETWORK = 30;
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Signs a visitor in as the one shared demo instructor. Public by design: there
 * is no password and no body, and the whole route answers 404 while the demo
 * switch is off. What the instructor session may then do is fenced in
 * src/proxy.ts by src/lib/demo/instructor-policy.ts.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  if (!isCohortDemoEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const network = await rateLimit(
    `demo-instructor:${clientIpBucket(req)}`,
    SIGN_INS_PER_NETWORK,
    SIGN_IN_WINDOW_MS,
  );
  if (!network.success) {
    return NextResponse.json({ error: DEMO_LIMIT_INSTRUCTOR }, { status: 429 });
  }

  // A rejection here becomes the generic 500. It is never retried, and the
  // clashing login or id is never logged.
  const { instructorId } = await ensureDemoClassroom();
  const sessionVersion = await readDemoInstructorSessionVersion(instructorId);
  await setSessionCookie(instructorId, "teacher", sessionVersion, { demo: "instructor" });

  // A failed audit write is logged by `tryLogAuditEvent` and must not undo a
  // sign-in that already set its cookie, so the result is not checked.
  await tryLogAuditEvent({
    actorId: instructorId,
    actorRole: "teacher",
    action: "demo.instructor.signin",
    targetType: "student",
    targetId: instructorId,
    summary: "Demo instructor sign-in.",
  });

  return NextResponse.json({ redirectTo: "/teacher" });
});
