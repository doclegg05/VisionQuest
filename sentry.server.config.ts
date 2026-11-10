import * as Sentry from "@sentry/nextjs";
import { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS } from "./src/lib/sentry-scrub";
import { type Transport, wireAllowlistTransport } from "./src/lib/sentry-wire";

type ServerOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type NodeTransportOptions = Parameters<typeof Sentry.makeNodeTransport>[0];

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
 *
 * `tracePropagationTargets` is empty. Left unset, the HTTP integration adds
 * `sentry-trace` and `baggage` headers (a trace id, the DSN's public key and
 * organization id) to every request this server makes, to any host, with
 * tracing off or on.
 *
 * The transport is the SDK's own Node transport behind the wire filter
 * (src/lib/sentry-wire.ts), which rebuilds every envelope before it is sent.
 * `beforeSend` alone is not enough: the SDK skips it for the report about
 * its own failure. A test passes a transport that records in place of the
 * SDK's; the filter is in front of it either way.
 */
export function serverSentryOptions(
  dsn: string,
  makeTransport: (options: NodeTransportOptions) => Transport = Sentry.makeNodeTransport,
): ServerOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    ...PRIVATE_REPORTING_OPTIONS,
    transport: wireAllowlistTransport(makeTransport),
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
