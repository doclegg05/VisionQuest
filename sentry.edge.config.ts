import * as Sentry from "@sentry/nextjs";
import { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS } from "./src/lib/sentry-scrub";
import { type Transport, wireAllowlistTransport } from "./src/lib/sentry-wire";

type EdgeOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
/** What the SDK passes a transport factory: the envelope URL, and how to count a drop. */
type TransportOptions = Parameters<NonNullable<EdgeOptions["transport"]>>[0];

/** `fetch` takes bytes over a plain buffer, and the SDK's type allows a shared one. A copy is a plain one. */
function fetchBody(body: string | Uint8Array): string | Uint8Array<ArrayBuffer> {
  return typeof body === "string" ? body : new Uint8Array(body);
}

/**
 * The edge runtime's transport: one POST of the envelope with `fetch`.
 *
 * It is written here because the SDK's own (`makeEdgeTransport` in
 * @sentry/vercel-edge build/cjs/index.js) is not exported by that package or
 * by @sentry/nextjs, so it cannot be wrapped. This is the same request,
 * built with the SDK's `createTransport`, which does the serializing, the
 * rate-limit handling and the buffering. One difference: the SDK's keeps its
 * requests in a private buffer until a flush, and this one starts each
 * request when the event is captured.
 */
export function makeEdgeFetchTransport(options: TransportOptions): Transport {
  return Sentry.createTransport(options, (request) =>
    Sentry.suppressTracing(() =>
      fetch(options.url, { body: fetchBody(request.body), method: "POST", headers: options.headers }).then((response) => ({
        statusCode: response.status,
        headers: {
          "x-sentry-rate-limits": response.headers.get("X-Sentry-Rate-Limits"),
          "retry-after": response.headers.get("Retry-After"),
        },
      })),
    ),
  );
}

/**
 * Edge error reporting: the same rules as the server
 * (sentry.server.config.ts). Errors only, built by the scrub, tracing off,
 * only the named integrations, and every envelope rebuilt by the wire filter
 * (src/lib/sentry-wire.ts) before the transport is handed it.
 */
export function edgeSentryOptions(dsn: string, makeTransport: (options: TransportOptions) => Transport = makeEdgeFetchTransport): EdgeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    ...PRIVATE_REPORTING_OPTIONS,
    transport: wireAllowlistTransport(makeTransport),
    integrations: errorOnlyIntegrations,
  };
}

if (process.env.SENTRY_DSN) Sentry.init(edgeSentryOptions(process.env.SENTRY_DSN));
