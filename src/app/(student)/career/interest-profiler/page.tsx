import Link from "next/link";
import PageIntro from "@/components/ui/PageIntro";
import { InterestProfilerWizard } from "@/components/career/InterestProfilerWizard";
import {
  OnetInterestProfilerToolsNote,
  OnetWebServicesAttribution,
} from "@/components/career/OnetAttribution";
import { getSession } from "@/lib/auth";

export default async function InterestProfilerPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Career"
        title="Interest Profiler"
        description="A short 30-question assessment that maps what kinds of work you like — then updates your Career DNA so Sage and job matches stay relevant."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/career/interest-profiler/import"
              prefetch={false}
              className="secondary-button px-4 py-3 text-sm"
            >
              Import scores
            </Link>
            <Link href="/career/profile" prefetch={false} className="secondary-button px-4 py-3 text-sm">
              Career DNA
            </Link>
          </div>
        }
      />
      <InterestProfilerWizard />
      <footer className="space-y-3">
        <OnetWebServicesAttribution />
        <OnetInterestProfilerToolsNote />
        <p className="text-xs text-[var(--ink-muted)]">
          Public (no login) O*NET interest-area information:{" "}
          <Link href="/onet-interest-areas" prefetch={false} className="underline">
            /onet-interest-areas
          </Link>
        </p>
      </footer>
    </div>
  );
}
