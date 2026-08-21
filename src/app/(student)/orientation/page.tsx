import OrientationWizard from "@/components/orientation/OrientationWizard";
import OrientationWelcomeVideo from "@/components/orientation/OrientationWelcomeVideo";
import PageIntro from "@/components/ui/PageIntro";

export default function OrientationPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Get started"
        title="Orientation"
        description="Watch, read, and sign each item to finish your SPOKES orientation."
      />
      <OrientationWelcomeVideo />
      <div className="surface-section p-5">
        <OrientationWizard />
      </div>
    </div>
  );
}
