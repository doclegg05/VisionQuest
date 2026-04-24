import { redirect } from "next/navigation";
import PageIntro from "@/components/ui/PageIntro";
import LibraryBrowser from "@/components/library/LibraryBrowser";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/");

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        eyebrow="Document library"
        title="Library"
        description="Search, preview, and download program documents, forms, and reference materials."
      />
      <LibraryBrowser />
    </div>
  );
}
