import { forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";

/**
 * Whose record a shared student/staff route reads. With no `requested`
 * value it is the caller's own. Otherwise only staff who manage that student
 * may read it, and the answer is the database id the guard returns: the
 * guard also accepts a login username, which must never reach a view row or
 * a data query (H15c item 3).
 */
export async function resolveTargetStudentId(
  session: Session,
  requested?: string | null,
): Promise<string> {
  const target = requested?.trim();
  if (!target || target === session.id) return session.id;
  if (!isStaffRole(session.role)) throw forbidden();
  const student = await assertStaffCanManageStudent(session, target);
  return student.id;
}
