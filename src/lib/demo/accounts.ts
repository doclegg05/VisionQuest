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
