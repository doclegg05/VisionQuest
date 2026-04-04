import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { checkStudentCompliance } from "@/lib/class-requirement-compliance";

/**
 * GET /api/class/requirements
 *
 * Returns the current student's class requirements and their compliance status.
 * Only returns "required" and "optional" items — "not_applicable" items are excluded.
 * Returns { enrolled: false } when the student has no active class enrollment.
 */
export const GET = withAuth(async (session) => {
  const compliance = await checkStudentCompliance(session.id);

  if (!compliance) {
    return NextResponse.json({ enrolled: false });
  }

  const visibleItems = compliance.items.filter(
    (item) => item.requiredStatus !== "not_applicable",
  );

  return NextResponse.json({
    enrolled: true,
    classId: compliance.classId,
    compliant: compliance.compliant,
    requiredCount: compliance.requiredCount,
    requiredMet: compliance.requiredMet,
    optionalCount: compliance.optionalCount,
    optionalMet: compliance.optionalMet,
    items: visibleItems,
  });
});
