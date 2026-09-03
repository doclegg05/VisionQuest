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
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-sky-200/80 bg-gradient-to-br from-sky-50/70 via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-sky-500 hover:shadow-lg hover:shadow-sky-500/10 transition-all duration-200 dark:border-sky-900/60 dark:from-sky-950/20"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-md shadow-sky-600/25 group-hover:scale-105 transition-transform">
              <Users size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-sky-700 dark:group-hover:text-sky-400 transition-colors">
                Class Rosters & QR Flyers
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                Cohorts, students & registration flyers
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-sky-700 dark:text-sky-300 opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            Open →
          </span>
        </Link>

        <Link
          href="/teacher/library"
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 dark:border-emerald-900/60 dark:from-emerald-950/20"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25 group-hover:scale-105 transition-transform">
              <Books size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                Forms & Document Library
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                State profiles, guidelines & paperwork
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-emerald-700 dark:text-emerald-300 opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            Open →
          </span>
        </Link>

        <Link
          href="/teacher/chat"
          className="group relative flex items-center justify-between p-4 rounded-2xl border-2 border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-[var(--surface-raised)] to-[var(--surface-base)] hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-200 dark:border-indigo-900/60 dark:from-indigo-950/20"
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/25 group-hover:scale-105 transition-transform">
              <ChatCircle size={22} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--ink-strong)] group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">
                Sage AI Assistant
              </p>
              <p className="text-xs font-medium text-[var(--ink-muted)]">
                Staff advising & curriculum mentor
              </p>
            </div>
          </div>
          <span className="hidden min-[400px]:inline-flex items-center text-xs font-bold text-indigo-700 dark:text-indigo-300 opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
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
