import { redirect } from "next/navigation";
import PageIntro from "@/components/ui/PageIntro";
import LibraryBrowser from "@/components/library/LibraryBrowser";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StudentLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        eyebrow="Library"
        title="Your document library"
        description="Study guides, orientation materials, and program resources — search and open anytime."
      />
      <LibraryBrowser />
    </div>
  );
}
