export default function CareerLoading() {
  return (
    <div className="page-shell space-y-6">
      {/* Journey strip skeleton */}
      <div className="surface-section animate-pulse">
        <div className="h-12 bg-[var(--surface-interactive)] rounded" />
      </div>
      
      {/* Page intro skeleton */}
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-24 bg-[var(--surface-interactive)] rounded" />
        <div className="h-8 w-32 bg-[var(--surface-interactive)] rounded" />
        <div className="h-4 w-full max-w-2xl bg-[var(--surface-interactive)] rounded" />
      </div>
      
      {/* Career DNA callout skeleton */}
      <div className="surface-section animate-pulse">
        <div className="h-24 bg-[var(--surface-interactive)] rounded" />
      </div>
      
      {/* Career hub sections skeleton */}
      <div className="space-y-6">
        <div className="surface-section space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-[var(--surface-interactive)] rounded" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-32 bg-[var(--surface-interactive)] rounded" />
            <div className="h-32 bg-[var(--surface-interactive)] rounded" />
          </div>
        </div>
        
        <div className="surface-section space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-[var(--surface-interactive)] rounded" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-32 bg-[var(--surface-interactive)] rounded" />
            <div className="h-32 bg-[var(--surface-interactive)] rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
