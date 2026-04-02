import ClassOverview from "@/components/teacher/ClassOverview";
import InterventionQueuePanel from "@/components/teacher/InterventionQueuePanel";
import PageIntro from "@/components/ui/PageIntro";

export default function TeacherDashboard() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Students"
        description="See student progress across goals, orientation, certification, and portfolio activity."
      />
      <InterventionQueuePanel />
      <ClassOverview />
    </div>
  );
}
