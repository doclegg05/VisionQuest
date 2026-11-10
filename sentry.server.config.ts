import * as Sentry from "@sentry/nextjs";
import { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS } from "./src/lib/sentry-scrub";

type ServerOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * Server error reporting: errors only, built by the scrub
 * (src/lib/sentry-scrub.ts).
 *
 * Tracing is off. One request in ten used to be sent as a transaction, with
 * its URL, its spans and the request body.
 *
 * The HTTP integration never reads an incoming request body. Its default
 * keeps a copy of every body in case an event wants it (the SDK's
 * `maxIncomingRequestBodySize` is "medium"), and a chat message or an intake
 * form is exactly what must not be on hand when an error is captured. Both
 * switches are set, so either one alone is enough. It still gives each
 * request its own scope, which is what keeps one request's route from being
 * tagged on another's error. Requests are not counted as sessions.
 */
export function serverSentryOptions(dsn: string): ServerOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    ...PRIVATE_REPORTING_OPTIONS,
    integrations: (defaults) => [
      ...errorOnlyIntegrations(defaults),
      Sentry.httpIntegration({
        disableIncomingRequestSpans: true,
        maxIncomingRequestBodySize: "none",
        ignoreIncomingRequestBody: () => true,
        trackIncomingRequestsAsSessions: false,
        breadcrumbs: false,
      }),
    ],
  };
}

if (process.env.SENTRY_DSN) Sentry.init(serverSentryOptions(process.env.SENTRY_DSN));
