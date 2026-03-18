import PageIntro from "@/components/ui/PageIntro";
import ResourceLibrary from "@/components/resources/ResourceLibrary";

export default function ResourcesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Reference library"
        title="Forms & Documents"
        description="Program forms, certification guides, and compliance documents. Your instructor will provide the actual forms — use this as your reference guide."
      />
      <ResourceLibrary />
    </div>
  );
}
