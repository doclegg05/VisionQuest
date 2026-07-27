// VQ-R-024: client-side Sentry init lives HERE, not in sentry.client.config.ts.
// Next 15+/Turbopack builds only load client instrumentation from
// src/instrumentation-client.ts — the old root config file was never bundled,
// so browser errors silently stopped reaching Sentry. Same init, new home,
// plus the router-transition hook the file convention enables.
import * as Sentry from "@sentry/nextjs";
import { scrubPii } from "@/lib/sentry-scrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    beforeSend: scrubPii,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
