import SpokesStudentWorkspace from "@/components/teacher/SpokesStudentWorkspace";

export default async function TeacherStudentSpokesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="page-shell">
      <SpokesStudentWorkspace studentId={id} />
    </div>
  );
}
