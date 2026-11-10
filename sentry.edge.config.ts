import * as Sentry from "@sentry/nextjs";
import { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS } from "./src/lib/sentry-scrub";

type EdgeOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * Edge error reporting: the same rules as the server
 * (sentry.server.config.ts). Errors only, built by the scrub, tracing off,
 * and only the named integrations.
 */
export function edgeSentryOptions(dsn: string): EdgeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    ...PRIVATE_REPORTING_OPTIONS,
    integrations: errorOnlyIntegrations,
  };
}

if (process.env.SENTRY_DSN) Sentry.init(edgeSentryOptions(process.env.SENTRY_DSN));
