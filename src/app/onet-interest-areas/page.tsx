import Link from "next/link";
import type { Metadata } from "next";
import BrandLockup from "@/components/ui/BrandLockup";
import {
  OnetInterestProfilerToolsNote,
  OnetWebServicesAttribution,
  ONET_MY_NEXT_MOVE_IP_URL,
  ONET_WEB_SERVICES_URL,
} from "@/components/career/OnetAttribution";
import { isOnetConfigured } from "@/lib/career/onet-config";
import { fetchRiasecInterests } from "@/lib/career/onet-interest-profiler";

export const metadata: Metadata = {
  title: "O*NET Interest Areas — VisionQuest",
  description:
    "Public O*NET Interest Profiler interest-area information from O*NET Web Services, with required attribution.",
};

export const dynamic = "force-dynamic";

/**
 * Free, no-registration page required by O*NET Web Services Terms of Service:
 * make information from the Web Service available in a publicly accessible area,
 * credit and link to O*NET Web Services, and present interest text without alteration.
 */
export default async function PublicOnetInterestAreasPage() {
  const configured = isOnetConfigured();
  const interestsResult = configured ? await fetchRiasecInterests() : null;
  const interests =
    interestsResult?.configured && !interestsResult.error
      ? interestsResult.interests ?? []
      : [];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <BrandLockup />
        </div>

        <header className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Public resource · no sign-in required
          </p>
          <h1 className="font-display text-3xl font-bold text-[var(--ink-strong)]">
            O*NET Interest Profiler interest areas
          </h1>
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            VisionQuest uses{" "}
            <a
              href={ONET_WEB_SERVICES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium text-[var(--ink-strong)]"
            >
              O*NET Web Services
            </a>{" "}
            to power career interest exploration for SPOKES students. This page
            republishes Interest Profiler interest-area titles and descriptions
            from that service for the public — free and without registration.
          </p>
        </header>

        <section className="mt-8 space-y-4" aria-labelledby="interest-areas-heading">
          <h2 id="interest-areas-heading" className="font-display text-xl font-bold">
            Interest areas (RIASEC)
          </h2>

          {!configured && (
            <div className="surface-section space-y-3 p-5 text-sm leading-6 text-[var(--ink-muted)]">
              <p>
                Live O*NET interest listings appear here once VisionQuest is connected
                to O*NET Web Services. Until then, explore the free Interest Profiler
                and interest information on My Next Move:
              </p>
              <a
                href={ONET_MY_NEXT_MOVE_IP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button inline-flex px-5 py-3 text-sm"
              >
                Open My Next Move Interest Profiler
              </a>
            </div>
          )}

          {configured && interests.length === 0 && (
            <p className="text-sm text-[var(--ink-muted)]" role="status">
              O*NET Web Services is configured, but interest areas could not be loaded
              right now. Try the free profiler on{" "}
              <a
                href={ONET_MY_NEXT_MOVE_IP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                My Next Move
              </a>
              .
            </p>
          )}

          {interests.length > 0 && (
            <ul className="space-y-4">
              {interests.map((interest) => (
                <li key={interest.code} className="surface-section p-5">
                  <h3 className="font-display text-lg font-bold text-[var(--ink-strong)]">
                    {interest.title}
                  </h3>
                  {/* Unaltered O*NET description text */}
                  <p className="mt-2 text-sm leading-6 text-[var(--ink)]">
                    {interest.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 space-y-3 text-sm leading-6 text-[var(--ink-muted)]">
          <h2 className="font-display text-lg font-bold text-[var(--ink-strong)]">
            Take the Interest Profiler
          </h2>
          <p>
            Anyone can take the free O*NET® Interest Profiler™ on{" "}
            <a
              href={ONET_MY_NEXT_MOVE_IP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              My Next Move
            </a>
            . SPOKES students signed into VisionQuest can also complete an in-app
            Mini Interest Profiler and save formal scores to Career DNA.
          </p>
          <Link href="/" prefetch={false} className="secondary-button inline-flex px-4 py-3 text-sm">
            Sign in to VisionQuest
          </Link>
        </section>

        <footer className="mt-12 space-y-4 border-t border-[var(--border)] pt-6">
          <OnetWebServicesAttribution />
          <OnetInterestProfilerToolsNote />
        </footer>
      </div>
    </div>
  );
}
