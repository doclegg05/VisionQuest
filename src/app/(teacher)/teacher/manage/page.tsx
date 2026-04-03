import ManageDashboard from "@/components/teacher/ManageDashboard";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";

export default async function ManagePage() {
  const session = await getSession();
  const isAdmin = session?.role === "admin";

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Program Setup"
        description="Manage curriculum, advising, opportunities, events, certification requirements, and live outcome reporting from one place."
      />
      <ManageDashboard canViewAudit={isAdmin} canViewAiConfig={isAdmin} />
    </div>
  );
}
