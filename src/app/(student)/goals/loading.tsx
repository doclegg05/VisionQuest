export default function GoalsLoading() {
  return (
    <div className="page-shell space-y-6">
      {/* Journey strip skeleton */}
      <div className="surface-section animate-pulse">
        <div className="h-12 bg-[var(--surface-interactive)] rounded" />
      </div>
      
      {/* Mountain progress skeleton */}
      <div className="surface-section mb-4 overflow-hidden p-0 animate-pulse">
        <div className="h-64 bg-[var(--surface-interactive)]" />
      </div>
      
      {/* Page intro skeleton */}
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-24 bg-[var(--surface-interactive)] rounded" />
        <div className="h-8 w-48 bg-[var(--surface-interactive)] rounded" />
        <div className="h-4 w-full max-w-2xl bg-[var(--surface-interactive)] rounded" />
      </div>
      
      {/* Goals skeleton */}
      <div className="surface-section space-y-4 animate-pulse">
        <div className="h-6 w-32 bg-[var(--surface-interactive)] rounded" />
        <div className="h-24 bg-[var(--surface-interactive)] rounded" />
        <div className="h-24 bg-[var(--surface-interactive)] rounded" />
      </div>
    </div>
  );
}
