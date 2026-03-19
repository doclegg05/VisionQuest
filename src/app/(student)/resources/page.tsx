import PageIntro from "@/components/ui/PageIntro";
import DocumentBrowser from "@/components/documents/DocumentBrowser";

export default function ResourcesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Reference library"
        title="Forms & Documents"
        description="Program forms, certification guides, and compliance documents. View, download, or print any document."
      />
      <div className="mt-8">
        <DocumentBrowser />
      </div>
    </div>
  );
}
