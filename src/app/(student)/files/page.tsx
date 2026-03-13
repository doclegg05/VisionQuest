import FileManager from "@/components/files/FileManager";
import PageIntro from "@/components/ui/PageIntro";

export default function FilesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Documents"
        title="My Files"
        description="Upload and manage documents, certificates, and other important files."
      />
      <FileManager />
    </div>
  );
}
