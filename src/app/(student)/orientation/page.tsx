import OrientationChecklist from "@/components/orientation/OrientationChecklist";
import ResourceLibrary from "@/components/resources/ResourceLibrary";
import PageIntro from "@/components/ui/PageIntro";

export default function OrientationPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Get started"
        title="Orientation"
        description="Complete these steps to get set up and ready for the SPOKES program."
      />
      <div className="surface-section p-5">
        <OrientationChecklist />
      </div>

      <div className="surface-section mt-8 p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Action forms
          </p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
            Orientation Forms
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Open the form you need, fill it out, and upload completed versions. Your instructor will review and approve submissions.
          </p>
        </div>
        <ResourceLibrary />
      </div>
    </div>
  );
}
