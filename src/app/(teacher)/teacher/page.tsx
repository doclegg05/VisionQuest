import ClassOverview from "@/components/teacher/ClassOverview";
import PageIntro from "@/components/ui/PageIntro";

export default function TeacherDashboard() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Class Dashboard"
        description="See student progress across goals, orientation, certification, and portfolio activity."
      />
      <ClassOverview />
    </div>
  );
}
