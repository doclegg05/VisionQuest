import { redirect } from "next/navigation";
import StudentDetail from "@/components/teacher/StudentDetail";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !isStaffRole(session.role)) redirect("/");

  return (
    <div className="page-shell">
      <StudentDetail studentId={id} />
    </div>
  );
}
