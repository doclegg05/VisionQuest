import { redirect } from "next/navigation";
import StudentDetail from "@/components/teacher/StudentDetail";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";

export default async function StudentDetailPage({
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
      <StudentDetail studentId={managedStudent.id} />
    </div>
  );
}
