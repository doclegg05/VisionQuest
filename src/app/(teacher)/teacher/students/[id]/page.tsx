import StudentDetail from "@/components/teacher/StudentDetail";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="page-shell">
      <StudentDetail studentId={id} />
    </div>
  );
}
