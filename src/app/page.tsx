import AuthPageClient from "@/components/auth/AuthPageClient";
import { isCohortDemoEnabled } from "@/lib/demo/config";

// COHORT_DEMO_MODE is read when the page renders. A prerendered page would
// freeze the value it saw at build time, so flipping the switch on Render
// would change nothing until the next build.
export const dynamic = "force-dynamic";

export default function AuthPage() {
  const googleAuthEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  );

  return (
    <AuthPageClient
      googleAuthEnabled={googleAuthEnabled}
      demoEnabled={isCohortDemoEnabled()}
    />
  );
}
