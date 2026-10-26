import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { recordStudentView } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { readOverview, readActivity } from "@/lib/dashboard/readers";
import { readTasks } from "@/lib/dashboard/tasks";
import { taskQuerySchema } from "@/lib/dashboard/task-schemas";
import { getStudentNextStep } from "@/lib/progression/student-next-step";

type Overview = Awaited<ReturnType<typeof readOverview>>;
type Activity = Awaited<ReturnType<typeof readActivity>>;
type TaskPage = Awaited<ReturnType<typeof readTasks>>;
type NextStep = Awaited<ReturnType<typeof getStudentNextStep>>;

const sectionHeading = "font-display text-xl font-semibold";
const mutedNote = "mt-2 text-sm text-[var(--ink-muted)]";

function Unavailable({ what }: { what: string }) {
  return <p className={mutedNote}>{what} could not load. Refresh this page to try again.</p>;
}

function Region<T>({ result, what, children }: { result: PromiseSettledResult<T>; what: string; children: (value: T) => ReactNode }) {
  return result.status === "fulfilled" ? children(result.value) : <Unavailable what={what} />;
}

function NextStepSection({ nextStep }: { nextStep: NextStep }) {
  return <section className="surface-section p-5">
    <h2 className={sectionHeading}>{nextStep.title}</h2>
    <p className="mt-2">{nextStep.description}</p>
    <p className={mutedNote}>{nextStep.whyItMatters}</p>
  </section>;
}

function OutcomesList({ overview }: { overview: Overview }) {
  return <dl className="grid gap-6 sm:grid-cols-2">
    {overview.outcomes.map((o) => <div key={o.label}>
      <dt className="font-semibold">{o.label}</dt>
      <dd><p className="mt-1 text-lg">{o.value}</p><p className={mutedNote}>{o.detail}</p></dd>
    </div>)}
  </dl>;
}

function TasksList({ tasks }: { tasks: TaskPage }) {
  if (!tasks.tasks.length) return <p className="mt-3">No tasks recorded.</p>;
  return <>
    <p className={mutedNote}>{tasks.total} recorded. First {tasks.pageSize} by due date. No changes can be made in this preview.</p>
    <ul className="mt-3 divide-y divide-[var(--border)]">
      {tasks.tasks.map((task) => <li key={task.id} className="py-3">
        <span className="font-semibold">{task.title}</span> · {task.status.replaceAll("_", " ")} · {task.personal ? "Personal" : "Staff assignment"}
      </li>)}
    </ul>
  </>;
}

function ActivityList({ activity }: { activity: Activity }) {
  return <>
    <ul className="mt-3">{activity.statuses.map((s) => <li key={s.status}>{s.status.replaceAll("_", " ")}: {s.count}</li>)}</ul>
    <p className={mutedNote}>Task activity is not verified program completion.</p>
  </>;
}

/** Read-only staff preview: never mount student-session queries or task editors. */
export default async function StudentDashboardPreview({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isStaffRole(session.role)) redirect("/");
  const student = await assertStaffCanManageStudent(session, (await params).id);
  await recordStudentView({ actorId: session.id, actorRole: session.role, targetStudentId: student.id, surface: "student_detail" });

  // Independent failures never erase other regions, matching the student dashboard.
  const [overview, tasks, activity, nextStep] = await Promise.allSettled([
    readOverview(student.id), readTasks(student.id, taskQuerySchema.parse({})),
    readActivity(student.id), getStudentNextStep(student.id),
  ]);
  const failedRegions = [overview, tasks, activity, nextStep].filter((r) => r.status === "rejected").length;
  if (failedRegions) logger.error("Dashboard preview regions failed", { actorId: session.id, surface: "teacher_dashboard_preview", failedRegions });
  const fetchedAt = new Date().toISOString().slice(0, 16).replace("T", " ");

  return <div className="page-shell space-y-6 text-[var(--ink-strong)]">
    <header>
      <h1 className="font-display text-2xl font-semibold">{student.displayName}’s dashboard preview</h1>
      <p className="mt-2 text-[var(--ink-muted)]">Read-only snapshot of student records, taken {fetchedAt} UTC. Manage assignments and reviews from Student Detail.</p>
      <Link className="mt-3 inline-flex min-h-11 items-center underline" href={`/teacher/students/${student.id}`}>Back to Student Detail</Link>
    </header>
    <Region result={nextStep} what="The next step">{(v) => <NextStepSection nextStep={v} />}</Region>
    <Region result={overview} what="Outcomes">{(v) => <OutcomesList overview={v} />}</Region>
    <section><h2 className={sectionHeading}>Tasks</h2><Region result={tasks} what="Tasks">{(v) => <TasksList tasks={v} />}</Region></section>
    <section><h2 className={sectionHeading}>Current task activity</h2><Region result={activity} what="Task activity">{(v) => <ActivityList activity={v} />}</Region></section>
  </div>;
}
