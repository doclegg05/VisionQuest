export default function LearningLoading() {
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
      
      {/* Resource center link skeleton */}
      <div className="mt-4 animate-pulse">
        <div className="h-20 bg-[var(--surface-interactive)] rounded-2xl" />
      </div>
      
      {/* Content sections skeleton */}
      <div className="space-y-8">
        <div className="surface-section space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-[var(--surface-interactive)] rounded" />
          <div className="h-32 bg-[var(--surface-interactive)] rounded" />
        </div>
        
        <div className="surface-section space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-[var(--surface-interactive)] rounded" />
          <div className="h-32 bg-[var(--surface-interactive)] rounded" />
        </div>
      </div>
    </div>
  );
}
