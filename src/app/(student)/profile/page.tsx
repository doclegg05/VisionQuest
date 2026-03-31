import Link from "next/link";
import { redirect } from "next/navigation";
import PageIntro from "@/components/ui/PageIntro";
import { CareerProfile } from "@/components/career/CareerProfile";
import { SkillGapBridge } from "@/components/career/SkillGapBridge";
import { getSession } from "@/lib/auth";
import { getCareerDiscovery } from "@/lib/career-discovery";
import { analyzeSkillGaps } from "@/lib/sage/skill-gap";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/");

  const [discovery, skillGapAnalysis] = await Promise.all([
    getCareerDiscovery(session.id),
    analyzeSkillGaps(session.id),
  ]);

  const isComplete = discovery?.status === "complete";

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="My Career DNA"
        title="Your Career Profile"
        description={
          isComplete
            ? "Your interests, skills, and values — decoded from your conversation with Sage."
            : "Your career assessment is in progress."
        }
        actions={
          isComplete ? (
            <Link
              href="/chat?stage=career_profile_review"
              prefetch={false}
              className="primary-button px-5 py-3 text-sm"
            >
              Discuss with Sage
            </Link>
          ) : undefined
        }
      />

      {!isComplete ? (
        <div className="surface-section p-6 text-center">
          <p className="text-base font-semibold text-[var(--ink-strong)]">
            Your Career DNA is not ready yet
          </p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Complete your career discovery conversation with Sage to unlock your profile.
          </p>
          <Link
            href="/chat"
            prefetch={false}
            className="primary-button mt-5 inline-flex px-5 py-3 text-sm"
          >
            Chat with Sage
          </Link>
        </div>
      ) : (
        // discovery is non-null when isComplete is true
        <>
          <CareerProfile discovery={discovery!} />
          <SkillGapBridge analysis={skillGapAnalysis} />
        </>
      )}
    </div>
  );
}
