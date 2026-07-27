import Image from "next/image";
import Link from "next/link";

export const ONET_WEB_SERVICES_URL = "https://services.onetcenter.org/";
export const ONET_MY_NEXT_MOVE_IP_URL = "https://www.mynextmove.org/explore/ip";

/**
 * Required O*NET Web Services attribution — matches the official “Copy HTML”
 * block from the developer My Account page (logo + credit + link).
 */
export function OnetWebServicesAttribution({
  className = "text-xs leading-5 text-[var(--ink-muted)]",
  showLogo = true,
}: {
  className?: string;
  showLogo?: boolean;
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {showLogo && (
        <p className="text-center">
          <a
            href={ONET_WEB_SERVICES_URL}
            title="This site incorporates information from O*NET Web Services. Click to learn more."
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              src="/onet-in-it.svg"
              alt="O*NET in-it"
              width={130}
              height={60}
              className="mx-auto h-[60px] w-[130px] border-0"
              unoptimized
            />
          </a>
        </p>
      )}
      <p>
        This site incorporates information from{" "}
        <a
          href={ONET_WEB_SERVICES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium text-[var(--ink-strong)]"
        >
          O*NET Web Services
        </a>{" "}
        by the U.S. Department of Labor, Employment and Training Administration
        (USDOL/ETA). O*NET® is a trademark of USDOL/ETA.
      </p>
    </div>
  );
}

/**
 * Career Exploration Tools note for in-app Mini Interest Profiler content
 * (questions / instrument), distinct from Web Services data license credit.
 */
export function OnetInterestProfilerToolsNote({
  className = "text-xs leading-5 text-[var(--ink-muted)]",
}: {
  className?: string;
}) {
  return (
    <p className={className}>
      This page includes information from the O*NET® Interest Profiler™ and O*NET
      Career Exploration Tools by the U.S. Department of Labor, Employment and
      Training Administration (USDOL/ETA). See the{" "}
      <a
        href="https://www.onetcenter.org/license_tools.html"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Career Exploration Tools licenses
      </a>
      . Anyone may also take the free web Interest Profiler on{" "}
      <a
        href={ONET_MY_NEXT_MOVE_IP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        My Next Move
      </a>
      . VisionQuest students can save formal scores to Career DNA after{" "}
      <Link href="/" prefetch={false} className="underline">
        signing in
      </Link>
      .
    </p>
  );
}
