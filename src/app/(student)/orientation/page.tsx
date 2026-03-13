import OrientationChecklist from "@/components/orientation/OrientationChecklist";
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
    </div>
  );
}
