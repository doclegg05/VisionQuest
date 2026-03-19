import OrientationChecklist from "@/components/orientation/OrientationChecklist";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
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

      <div className="mt-8">
        <h2 className="font-display text-lg text-[var(--ink-strong)] mb-4">
          Orientation Documents
        </h2>
        <DocumentBrowser
          category="ORIENTATION"
          showCategoryFilter={false}
          compact
        />
      </div>
    </div>
  );
}
