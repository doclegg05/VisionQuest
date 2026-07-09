import Link from "next/link";
import { CareerDnaEmptyState } from "@/components/career/CareerDnaEmptyState";
import { CareerDnaHighlights } from "@/components/career/CareerDnaHighlights";
import { CareerProfile } from "@/components/career/CareerProfile";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { getCareerProfile } from "@/lib/career-profile";

export default async function CareerProfilePage() {
  const session = await getSession();
  if (!session) return null;

  const profile = await getCareerProfile(session.id);

  return (
    <div className="page-shell space-y-6">
      <PageIntro
        eyebrow="Career"
        title="Your Career DNA"
        description="What Sage has learned about your interests, strengths, and work values — and the career paths that fit you."
        actions={
          <Link href="/career" prefetch={false} className="secondary-button px-4 py-3 text-sm">
            Back to Career
          </Link>
        }
      />

      {profile?.isComplete ? (
        <>
          <CareerDnaHighlights topInterests={profile.topInterests} />
          <CareerProfile discovery={profile.discovery} />
        </>
      ) : (
        <>
          <CareerDnaEmptyState completeness={profile?.completeness ?? null} />
          {profile && <CareerDnaHighlights topInterests={profile.topInterests} />}
        </>
      )}
    </div>
  );
}
