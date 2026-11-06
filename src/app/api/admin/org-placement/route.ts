import { NextResponse } from "next/server";
import { forbidden, withAuth } from "@/lib/api-error";
import { listApplicantsWaiting, listUnplacedStaff } from "@/lib/org-placement";
import { seesWholeState } from "@/lib/org-roles";

// Admins and program coordinators only. `withAdminAuth` admits admins alone,
// so this uses `withAuth` and the shared whole-state check.
export const GET = withAuth(async (session) => {
  if (!seesWholeState(session.role)) throw forbidden();
  const [unplacedStaff, applicants] = await Promise.all([
    listUnplacedStaff(session),
    listApplicantsWaiting(session),
  ]);
  return NextResponse.json({ success: true, data: { unplacedStaff, applicants } });
});
