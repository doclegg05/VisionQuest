import { prismaAdmin } from "@/lib/db";

/**
 * Cohort demo mode: is this id a demo account?
 *
 * Reads only the `demoAccount` column, through the admin client. The senders
 * that ask (the crisis alert, the teacher nudge, the employer packet) run
 * inside a student's RLS context, and the answer must not depend on what that
 * context can see. A missing row is "not a demo account", so a real person's
 * behavior is exactly what it was before demo mode existed.
 *
 * This reads the database column, not the session marker, so it holds when the
 * demo switch is off: a demo row never gets mail just because the page that
 * signs it in is hidden.
 *
 * A failed lookup throws. Each caller decides what a doubt means for it: a
 * sender that could reach a real person stops (fails closed), and the safety
 * fallbacks treat it as a real account, since over-notifying is their safe
 * direction.
 */
export async function isDemoStudentId(studentId: string): Promise<boolean> {
  const row = await prismaAdmin.student.findUnique({
    where: { id: studentId },
    select: { demoAccount: true },
  });
  return Boolean(row?.demoAccount);
}

/**
 * The fail-open reading of `isDemoStudentId`, for the two safety fallbacks (the
 * crisis alert and the teacher nudge). A lookup that throws counts as "not a
 * demo account" and is handed to `onError` for the caller to log. For a real
 * student the program-wide fallback is the safe direction, so a doubt about the
 * demo marker must never narrow it.
 *
 * Both callers share this one policy so a change to it (a timeout, a retry)
 * cannot reach one fallback and skip the other. They differ only in what they
 * log, which they pass in.
 */
export async function isDemoStudentIdOrFalse(
  studentId: string,
  onError: (error: unknown) => void,
): Promise<boolean> {
  try {
    return await isDemoStudentId(studentId);
  } catch (error) {
    onError(error);
    return false;
  }
}
