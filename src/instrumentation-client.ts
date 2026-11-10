/**
 * Browser error reporting (H1, 2026-11-10).
 *
 * Next loads this file in the browser before the app hydrates, under
 * Turbopack and webpack alike. It replaces sentry.client.config.ts, which
 * @sentry/nextjs 10 reads only on its webpack path
 * (build/cjs/config/webpack.js), so under `next build` on Next 16 no browser
 * client existed and src/app/error.tsx logged "No client configured".
 *
 * Errors only: no tracing, no session replay, no profiling. Every event goes
 * through scrubPii (src/lib/sentry-scrub.ts).
 *
 * The SDK is not imported here. It is fetched as its own chunk once the page
 * has loaded and the browser is idle, so it adds nothing to the scripts a
 * page needs before it is interactive; students are on low-end phones and
 * the sign-in page has a weight budget. Errors thrown before it arrives are
 * held (up to MAX_HELD_ERRORS) and sent once it has. What is lost: an error
 * caught by a React error boundary before the SDK loads (src/app/error.tsx
 * and src/app/global-error.tsx call captureException with no client yet),
 * and anything at all if the visitor leaves before the page finishes
 * loading. A root-layout failure during server rendering is still reported
 * by the server (onRequestError in src/instrumentation.ts).
 */
import { scrubPii } from "@/lib/sentry-scrub";

const MAX_HELD_ERRORS = 10;
/** The longest an idle browser may keep the SDK waiting after load. */
const IDLE_TIMEOUT_MS = 5_000;
const DROPPED_INTEGRATIONS = new Set(["BrowserTracing", "Replay", "ReplayCanvas", "BrowserProfiling"]);

/** The parts of `window` the reporter touches; a test passes a stand-in. */
export interface ReportingPage {
  addEventListener: EventTarget["addEventListener"];
  removeEventListener: EventTarget["removeEventListener"];
  setTimeout: (callback: () => void, ms?: number) => unknown;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown;
  document: { readyState: DocumentReadyState };
}

interface Integration {
  name: string;
}

function keepErrorIntegrations<I extends Integration>(defaults: I[]): I[] {
  return defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name));
}

function afterLoadAndIdle(page: ReportingPage, run: () => void): void {
  const whenIdle = () =>
    page.requestIdleCallback ? page.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS }) : page.setTimeout(run, 0);
  if (page.document.readyState === "complete") {
    whenIdle();
    return;
  }
  page.addEventListener("load", whenIdle, { once: true });
}

/** Holds errors thrown before the SDK has its own global handlers. */
function holdEarlyErrors(page: ReportingPage): { held: unknown[]; release: () => void } {
  const held: unknown[] = [];
  const hold = (reason: unknown) => {
    if (held.length < MAX_HELD_ERRORS) held.push(reason);
  };
  const onError = (event: Event) => hold("error" in event ? event.error : event);
  const onRejection = (event: Event) => hold("reason" in event ? event.reason : event);
  page.addEventListener("error", onError);
  page.addEventListener("unhandledrejection", onRejection);
  const release = () => {
    page.removeEventListener("error", onError);
    page.removeEventListener("unhandledrejection", onRejection);
  };
  return { held, release };
}

async function loadAndInit(dsn: string, early: { held: unknown[]; release: () => void }): Promise<void> {
  // Destructured, so a bundler that tree-shakes dynamic imports keeps only
  // these two exports in the chunk.
  const { init, captureException } = await import("@sentry/nextjs");
  init({
    dsn,
    environment: process.env.NODE_ENV,
    beforeSend: scrubPii,
    beforeSendTransaction: scrubPii,
    integrations: keepErrorIntegrations,
  });
  early.release();
  for (const error of early.held.splice(0)) captureException(error);
}

export function startErrorReporting(page: ReportingPage, dsn: string): void {
  const early = holdEarlyErrors(page);
  afterLoadAndIdle(page, () => {
    loadAndInit(dsn, early).catch((error: unknown) => {
      early.release();
      // The reporter itself failed (an offline phone, a blocked chunk); the
      // console is the only place left to say so.
      console.error("Error reporting could not start", error instanceof Error ? error.name : typeof error);
    });
  });
}

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn && typeof window !== "undefined") startErrorReporting(window, dsn);
