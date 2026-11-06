import PageIntro from "@/components/ui/PageIntro";

/**
 * Shown on /teacher to an instructor who has no region and no class yet.
 * Nothing about any student appears here.
 */
export function UnplacedStaffNotice() {
  return (
    <div className="page-shell space-y-4">
      <PageIntro
        eyebrow="Instructor"
        title="You are almost ready"
        description="Your account is set up. It is not placed in a region yet."
      />
      <p className="theme-card rounded-xl p-5 text-base text-[var(--ink-strong)]">
        Ask your regional coordinator to invite you to your region.
      </p>
    </div>
  );
}
