import ClassRosterManager from "@/components/teacher/ClassRosterManager";
import PageIntro from "@/components/ui/PageIntro";

export default function AdminSettingsPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Admin settings"
        title="Program Classes"
        description="Create SPOKES classes, assign instructors, manage orientation invites, and archive class enrollments without deleting student history."
      />
      {/* Operations Quick Hub */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-6">
        <a
          href="/teacher"
          className="flex items-center gap-3 p-3.5 rounded-xl border-2 border-info bg-info-soft hover:bg-info-soft transition-all shadow-sm group"
        >
          <div className="p-2 rounded-lg bg-info text-on-info shadow-sm group-hover:scale-105 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.74a8,8,0,0,1-11.07-2.33,79.83,79.83,0,0,0-54.54-38.33,8,8,0,1,1,3.08-15.7,95.84,95.84,0,0,1,64.86,45.3A8,8,0,0,1,250.14,206.74ZM172,152a44,44,0,1,0-44-44,8,8,0,0,1-16,0,60,60,0,1,1,60,60,8,8,0,0,1,0-16Z"></path></svg>
          </div>
          <div>
            <p className="text-sm font-bold text-info">Students Dashboard</p>
            <p className="text-xs text-info">Interventions, rosters & batch forms</p>
          </div>
        </a>

        <a
          href="/coordinator"
          className="flex items-center gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)] transition-colors shadow-sm"
        >
          <div className="p-2 rounded-lg bg-success-soft text-success">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M240,208H224V96a16,16,0,0,0-16-16H144V32a16,16,0,0,0-24.88-13.32L39.12,72A16,16,0,0,0,32,85.34V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM208,96V208H144V96ZM48,85.34,128,32V208H48Z"></path></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Regional Rollup</p>
            <p className="text-xs text-[var(--ink-muted)]">Coordinator oversight & analytics</p>
          </div>
        </a>

        <a
          href="/teacher/manage"
          className="flex items-center gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)] transition-colors shadow-sm"
        >
          <div className="p-2 rounded-lg bg-info-soft text-info">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"></path></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Program Setup</p>
            <p className="text-xs text-[var(--ink-muted)]">Configure pathways & benchmarks</p>
          </div>
        </a>

        <a
          href="/teacher/failed-extractions"
          className="flex items-center gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)] transition-colors shadow-sm"
        >
          <div className="p-2 rounded-lg bg-warning-soft text-warning">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z"></path></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">AI Extraction Review</p>
            <p className="text-xs text-[var(--ink-muted)]">Audit failed transcript extractions</p>
          </div>
        </a>
      </div>

      <ClassRosterManager />
    </div>
  );
}
