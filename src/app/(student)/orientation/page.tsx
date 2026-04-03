import OrientationWizard from "@/components/orientation/OrientationWizard";
import PageIntro from "@/components/ui/PageIntro";

export default function OrientationPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Get started"
        title="Orientation"
        description="Read and sign each document to complete your SPOKES orientation."
      />
      <div className="surface-section p-5">
        <OrientationWizard />
      </div>
    </div>
  );
}
