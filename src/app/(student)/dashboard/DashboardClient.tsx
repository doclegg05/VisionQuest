"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import * as Toast from "@radix-ui/react-toast";
import { QueryClient, QueryClientProvider, useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardActivity, DashboardOverview } from "@/lib/dashboard/readers";
import type { TaskDto, TaskPage } from "@/lib/dashboard/tasks";
import { taskQuerySchema, type TaskDetails, type TaskQuery } from "@/lib/dashboard/task-schemas";
import { dashboardFetch, dashboardKey, freshness, optimisticTasks, shouldShowMutationNotice, taskKey } from "@/lib/dashboard/query";
import { TaskTable } from "@/components/dashboard/TaskTable";
import type { DashboardSupport } from "@/lib/dashboard/support";
import { PathToEmployment } from "@/components/progression/PathToEmployment";
import type { ReactNode } from "react";
import styles from "@/components/dashboard/dashboard.module.css";

const TaskCharts = dynamic(() => import("@/components/dashboard/TaskCharts"), { ssr: false, loading: () => <p role="status">Loading task charts…</p> });
export interface DashboardClientProps {
  sessionId: string;
  initialOverview?: DashboardOverview;
  initialActivity?: DashboardActivity;
  initialTasks?: TaskPage;
  initialSupport?: DashboardSupport;
  moodContent?: ReactNode;
}

/** Private cache lives only inside this session's mounted dashboard. */
export default function DashboardClient(props: DashboardClientProps) {
  return <SessionDashboard key={props.sessionId} {...props} />;
}
function SessionDashboard(props: DashboardClientProps) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { ...freshness, gcTime: 5 * 60_000 } } }));
  useEffect(() => () => { client.clear(); }, [client]);
  return <QueryClientProvider client={client}><DashboardWorkspace {...props} /></QueryClientProvider>;
}
function RegionStatus({ loading, error, refreshing, hasData, fetchedAt, retry }: {
  loading: boolean; error: boolean; refreshing: boolean; hasData: boolean; fetchedAt?: string; retry: () => void;
}) {
  return <div className="my-3 text-sm text-[var(--ink-muted)]" aria-live="polite">
    {loading ? "Loading your records…" : error ? <><span>{hasData ? "Showing last saved data. Refresh failed; these records may be out of date." : "This section could not load. Other sections are still available."}</span> <button className="min-h-11 underline" onClick={retry}>Try again</button></> : refreshing ? "Refreshing…" : fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC · checks every 30 seconds while visible` : null}
  </div>;
}
function DashboardWorkspace({ sessionId, initialOverview, initialActivity, initialTasks, initialSupport, moodContent }: DashboardClientProps) {
  const client = useQueryClient();
  const router = useRouter();
  const [query, setQuery] = useState<TaskQuery>(() => taskQuerySchema.parse({}));
  const [notice, setNotice] = useState<{ message: string; open: boolean }>({ message: "", open: false });
  const root = dashboardKey(sessionId);
  const pending = useIsMutating({ mutationKey: root }) > 0;
  const options = { ...freshness, enabled: !pending };
  const overview = useQuery({ ...options, queryKey: [...root, "overview"], queryFn: ({ signal }) => dashboardFetch<DashboardOverview>("/api/dashboard/overview", { signal }), initialData: initialOverview, initialDataUpdatedAt: initialOverview ? Date.parse(initialOverview.fetchedAt) : undefined });
  const activity = useQuery({ ...options, queryKey: [...root, "activity"], queryFn: ({ signal }) => dashboardFetch<DashboardActivity>("/api/dashboard/activity", { signal }), initialData: initialActivity, initialDataUpdatedAt: initialActivity ? Date.parse(initialActivity.fetchedAt) : undefined });
  const support = useQuery({ ...options, queryKey: [...root, "support"], queryFn: ({ signal }) => dashboardFetch<DashboardSupport>("/api/dashboard/support", { signal }), initialData: initialSupport, initialDataUpdatedAt: initialSupport ? Date.parse(initialSupport.fetchedAt) : undefined });
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const isDefault = JSON.stringify(query) === JSON.stringify(taskQuerySchema.parse({}));
  const tasks = useQuery({ ...options, queryKey: [...taskKey(sessionId), query], queryFn: ({ signal }) => dashboardFetch<TaskPage>(`/api/tasks?${params}`, { signal }), initialData: isDefault ? initialTasks : undefined, initialDataUpdatedAt: initialTasks ? Date.parse(initialTasks.fetchedAt) : undefined });
  type Mutation = { url: string; method: string; body: unknown; updates?: { id: string; patch: Partial<TaskDto> }[]; quietConflicts?: boolean };
  const mutation = useMutation({
    mutationKey: root,
    mutationFn: ({ url, method, body }: Mutation) => dashboardFetch<{ audited?: boolean; alertsSynced?: boolean }>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onMutate: async (variables) => {
      await client.cancelQueries({ queryKey: root });
      return { rollback: optimisticTasks(client, taskKey(sessionId), variables.updates ?? []) };
    },
    onError: (error, variables, context) => { context?.rollback(); if (shouldShowMutationNotice(error, variables)) setNotice({ open: true, message: error.message }); },
    onSuccess: (result) => { setNotice({ open: true, message: result.audited === false || result.alertsSynced === false ? "Task saved. Some follow-up updates are delayed; your instructor may need to check them." : "Task saved." }); router.refresh(); },
    onSettled: () => { void client.invalidateQueries({ queryKey: root }); },
  });
  const save = async (values: TaskDetails, task?: TaskDto, version?: string) => {
    await mutation.mutateAsync({ url: task ? `/api/tasks/${task.id}` : "/api/tasks", method: task ? "PATCH" : "POST", body: task ? { ...values, updatedAt: version ?? task.updatedAt } : values, quietConflicts: !!task });
  };
  const remove = async (task: TaskDto) => {
    await mutation.mutateAsync({ url: `/api/tasks/${task.id}`, method: "DELETE", body: { updatedAt: task.updatedAt } });
  };
  const setStatus = (selected: TaskDto[], status: string) => {
    mutation.mutate({ url: "/api/tasks/bulk-status", method: "PATCH", body: { status, tasks: selected.map(({ id, updatedAt }) => ({ id, updatedAt })) }, updates: selected.map(({ id }) => ({ id, patch: { status } })) });
  };
  return <Toast.Provider duration={6000}>
    <div className={`${styles.workspace} min-w-0 space-y-6 text-[var(--ink-strong)]`}>
      <section aria-label="Your next action">
        {support.data && <PathToEmployment {...support.data.nextStep} />}
        <RegionStatus loading={support.isPending} error={support.isError} refreshing={support.isFetching && !support.isPending} hasData={!!support.data} fetchedAt={support.data?.fetchedAt} retry={() => { void support.refetch(); }} />
        {!support.data && support.isError && <Link className="underline" href="/goals">Review your plan while this section is unavailable</Link>}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">Your recorded progress</h2><button disabled={pending || overview.isFetching || activity.isFetching || tasks.isFetching} className="secondary-button px-4 py-2 text-sm" onClick={() => { void client.invalidateQueries({ queryKey: root }); router.refresh(); }}>Refresh dashboard</button></div>
      <section aria-label="Outcome summaries">
        <RegionStatus loading={overview.isPending} error={overview.isError} refreshing={overview.isFetching && !overview.isPending} hasData={!!overview.data} fetchedAt={overview.data?.fetchedAt} retry={() => { void overview.refetch(); }} />
        {overview.data && <dl className="grid gap-x-8 gap-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 sm:grid-cols-2 xl:grid-cols-4">{overview.data.outcomes.map((outcome) => <div key={outcome.label} className="min-w-0"><dt className="font-semibold">{outcome.label}</dt><dd className="mt-2"><p className="text-lg font-semibold leading-snug">{outcome.value}</p><p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{outcome.detail}</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-secondary)] underline underline-offset-4" href={outcome.href}>View {outcome.label.toLowerCase()}</Link></dd></div>)}</dl>}
      </section>
      <section aria-labelledby="tasks-heading" className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 sm:p-6">
        <TaskTable data={tasks.data} query={query} setQuery={setQuery} pending={pending || tasks.isFetching} save={save} remove={remove} setStatus={setStatus} />
        <RegionStatus loading={tasks.isPending} error={tasks.isError} refreshing={tasks.isFetching && !tasks.isPending} hasData={!!tasks.data} fetchedAt={tasks.data?.fetchedAt} retry={() => { void tasks.refetch(); }} />
      </section>
      <section aria-label="Advising and support" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Advising and support</h2>
        {support.data ? <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div><h3 className="font-semibold">Follow-up alerts</h3><p className="mt-2 text-sm">{support.data.alertCount ? `${support.data.alertCount} alerts need your attention.` : "No follow-up alerts right now."}</p><Link className="inline-flex min-h-11 items-center underline" href="/appointments">View advising</Link></div>
          <div><h3 className="font-semibold">Next appointment</h3>{support.data.appointment ? <><p className="mt-2 break-words">{support.data.appointment.title}</p><p className="mt-1 text-sm">{new Date(support.data.appointment.startsAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} Eastern</p><p className="text-sm">{support.data.appointment.locationLabel}</p></> : <p className="mt-2 text-sm">No upcoming appointment recorded.</p>}<Link className="inline-flex min-h-11 items-center underline" href="/appointments">Open appointments</Link></div>
          {support.data.orientationItems.length > 0 && <div><h3 className="font-semibold">Next orientation items</h3><ul className="mt-2 list-inside list-disc text-sm">{support.data.orientationItems.map((item) => <li key={item.id}>{item.label}</li>)}</ul><Link className="inline-flex min-h-11 items-center underline" href="/orientation">Continue orientation</Link></div>}
          {moodContent}
        </div> : <p className="mt-3 text-sm">{support.isPending ? "Loading advising…" : "Advising is unavailable. Retry Your next action above, or open appointments."} <Link className="underline" href="/appointments">Open appointments</Link></p>}
        {support.isError && support.data && <p className="mt-3 text-sm" role="status">Showing last loaded advising data. <button className="min-h-11 underline" onClick={() => { void support.refetch(); }}>Retry advising</button></p>}
      </section>
      <section aria-labelledby="activity-heading" className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 sm:p-6">
        <h2 id="activity-heading" className="font-display text-xl font-semibold">Task activity</h2>
        <RegionStatus loading={activity.isPending} error={activity.isError} refreshing={activity.isFetching && !activity.isPending} hasData={!!activity.data} fetchedAt={activity.data?.fetchedAt} retry={() => { void activity.refetch(); }} />
        {activity.data && <TaskCharts data={activity.data} />}
      </section>
    </div>
    <Toast.Root open={notice.open} onOpenChange={(open) => setNotice((value) => ({ ...value, open }))} className={`${styles.notice} rounded-xl border border-[var(--border)] p-4 text-[var(--ink-strong)] shadow-lg`}><Toast.Description>{notice.message}</Toast.Description><Toast.Close className="mt-2 min-h-11 underline">Dismiss</Toast.Close></Toast.Root>
    <Toast.Viewport className="fixed bottom-24 right-4 z-[120] w-[calc(100%-2rem)] max-w-sm md:bottom-6" />
  </Toast.Provider>;
}
