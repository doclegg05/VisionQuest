import Link from "next/link";
import { Users, Books, ChatCircle } from "@phosphor-icons/react/dist/ssr";
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
    <div className="page-shell space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <PageIntro
          eyebrow="Teacher workspace"
          title="Student Interventions & Daily Overview"
          description="Track student momentum, review state intake forms and paperwork, and manage classroom rosters."
        />
        <ClassContextSwitcher />
      </div>

      {/* Quick Access Bar for Teachers - High Contrast, Tactile Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/teacher/classes"
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-info bg-gradient-to-br from-info-soft via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-info hover:shadow-lg transition-all duration-200"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info text-on-info shadow-md group-hover:scale-105 transition-transform">
              <Users size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-info transition-colors">
                Class Rosters & QR Flyers
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                Cohorts, students & registration flyers
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-info opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            Open →
          </span>
        </Link>

        <Link
          href="/teacher/library"
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-success bg-gradient-to-br from-success-soft via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-success hover:shadow-lg transition-all duration-200"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success text-on-success shadow-md group-hover:scale-105 transition-transform">
              <Books size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-success transition-colors">
                Forms & Document Library
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                State profiles, guidelines & paperwork
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-success opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            Open →
          </span>
        </Link>

        <Link
          href="/teacher/chat"
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-info bg-gradient-to-br from-info-soft via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-info hover:shadow-lg transition-all duration-200"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info text-on-info shadow-md group-hover:scale-105 transition-transform">
              <ChatCircle size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-info transition-colors">
                Sage AI Assistant
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                Staff advising & curriculum mentor
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-info opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            Open →
          </span>
        </Link>
      </div>

      <TodayRoster roster={todayRoster} />
      <InterventionQueuePanel initialQueue={data.queue.queue} />
      <ClassOverview initialData={data.overview} />
    </div>
  );
}
