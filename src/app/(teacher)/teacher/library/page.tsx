import { redirect } from "next/navigation";
import PageIntro from "@/components/ui/PageIntro";
import LibraryBrowser from "@/components/library/LibraryBrowser";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export default async function TeacherLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isStaffRole(session.role)) redirect("/");

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        eyebrow="Document library"
        title="Library"
        description="Program documents, DOHS forms, LMS guides, and certification references — searchable, previewable, downloadable."
      />
      <LibraryBrowser />
    </div>
  );
}
