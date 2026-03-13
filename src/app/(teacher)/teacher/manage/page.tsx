import ManageDashboard from "@/components/teacher/ManageDashboard";
import PageIntro from "@/components/ui/PageIntro";

export default function ManagePage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Manage Content"
        description="Manage curriculum, advising, opportunities, events, certification requirements, and live outcome reporting from one place."
      />
      <ManageDashboard />
    </div>
  );
}
