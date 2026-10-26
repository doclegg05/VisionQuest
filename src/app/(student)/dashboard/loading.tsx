import Link from "next/link";

export default function DashboardLoading() {
  return <div className="page-shell page-shell-wide space-y-6" aria-busy="true">
    <h1 className="font-display text-2xl font-semibold">Your dashboard</h1>
    <p role="status">Loading your next action and recorded progress…</p>
    <div className="grid gap-6 sm:grid-cols-2" aria-hidden="true">{["Progress", "Tasks", "Activity", "Advising"].map((label) => <div key={label} className="h-40 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5">{label}</div>)}</div>
    <Link className="inline-flex min-h-11 items-center underline" href="/chat">Talk to Sage while you wait</Link>
  </div>;
}
