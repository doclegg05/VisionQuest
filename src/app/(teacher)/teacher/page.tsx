import { getSession } from "@/lib/auth";
import ClassOverview from "@/components/teacher/ClassOverview";
import InterventionQueuePanel from "@/components/teacher/InterventionQueuePanel";
import PageIntro from "@/components/ui/PageIntro";
import { getTeacherHomeData } from "@/lib/teacher/dashboard";

export default async function TeacherDashboard() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const data = await getTeacherHomeData(session);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Students"
        description="See student progress across goals, orientation, certification, and portfolio activity."
      />
      <InterventionQueuePanel initialQueue={data.queue.queue} />
      <ClassOverview initialData={data.overview} />
    </div>
  );
}
