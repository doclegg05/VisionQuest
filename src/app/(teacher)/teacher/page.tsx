import { getSession } from "@/lib/auth";
import ClassContextSwitcher from "@/components/teacher/ClassContextSwitcher";
import ClassOverview from "@/components/teacher/ClassOverview";
import InterventionQueuePanel from "@/components/teacher/InterventionQueuePanel";
import TodayRoster from "@/components/teacher/TodayRoster";
import PageIntro from "@/components/ui/PageIntro";
import { getTeacherHomeData } from "@/lib/teacher/dashboard";
import { getTodayRoster } from "@/lib/teacher/today";

interface TeacherDashboardProps {
  searchParams: Promise<{ classId?: string | string[] }>;
}

export default async function TeacherDashboard({ searchParams }: TeacherDashboardProps) {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const params = await searchParams;
  const rawClassId = Array.isArray(params.classId) ? params.classId[0] : params.classId;
  const classId = rawClassId?.trim() || undefined;

  const [data, todayRoster] = await Promise.all([
    getTeacherHomeData(session, { classId }),
    getTodayRoster(session, { classId }),
  ]);

  return (
    <div className="page-shell">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <PageIntro
          eyebrow="Teacher tools"
          title="Students"
          description="See student progress across goals, orientation, certification, and portfolio activity."
        />
        <ClassContextSwitcher />
      </div>
      <TodayRoster roster={todayRoster} />
      <InterventionQueuePanel initialQueue={data.queue.queue} />
      <ClassOverview initialData={data.overview} />
    </div>
  );
}
