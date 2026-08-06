import Link from "next/link";
import PageIntro from "@/components/ui/PageIntro";
import { InterestProfilerImportForm } from "@/components/career/InterestProfilerImportForm";
import {
  OnetInterestProfilerToolsNote,
  OnetWebServicesAttribution,
} from "@/components/career/OnetAttribution";
import { getSession } from "@/lib/auth";

export default async function InterestProfilerImportPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Career"
        title="Import Interest Profiler scores"
        description="Already finished CareerOneStop or My Next Move? Enter your six interest scores here so VisionQuest and Sage can use them."
        actions={
          <Link
            href="/career/interest-profiler"
            prefetch={false}
            className="secondary-button px-4 py-3 text-sm"
          >
            Take in-app profiler
          </Link>
        }
      />
      <InterestProfilerImportForm />
      <footer className="space-y-3">
        <OnetWebServicesAttribution />
        <OnetInterestProfilerToolsNote />
      </footer>
    </div>
  );
}
