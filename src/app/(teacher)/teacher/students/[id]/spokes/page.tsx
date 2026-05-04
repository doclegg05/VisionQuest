import { redirect } from "next/navigation";
import SpokesStudentWorkspace from "@/components/teacher/SpokesStudentWorkspace";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";

export default async function TeacherStudentSpokesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !isStaffRole(session.role)) redirect("/");

  const managedStudent = await assertStaffCanManageStudent(session, id);

  return (
    <div className="page-shell">
      <SpokesStudentWorkspace studentId={managedStudent.id} />
    </div>
  );
}
