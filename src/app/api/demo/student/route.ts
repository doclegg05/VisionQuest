import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-error";
import { setSessionCookie } from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
import { isCohortDemoEnabled } from "@/lib/demo/config";
import { createDemoStudent } from "@/lib/demo/create-student";

/**
 * Signs a visitor in as a brand-new demo student. Public by design: there is no
 * session to check, no body to read, and the whole route answers 404 while the
 * demo switch is off.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  if (!isCohortDemoEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await createDemoStudent(clientIpBucket(req));
  if (result.kind === "limited") {
    return NextResponse.json({ error: result.message }, { status: 429 });
  }

  const { student } = result;
  await setSessionCookie(student.id, "student", student.sessionVersion, { demo: "student" });

  return NextResponse.json({
    redirectTo: "/dashboard",
    student: { displayName: student.displayName },
  });
});
