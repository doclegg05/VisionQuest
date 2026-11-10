/**
 * Browser error reporting (H1, 2026-11-10).
 *
 * Next loads this file in the browser before the app hydrates, under
 * Turbopack and webpack alike. It replaces sentry.client.config.ts, which
 * @sentry/nextjs 10 reads only on its webpack path
 * (build/cjs/config/webpack.js), so under `next build` on Next 16 no browser
 * client existed and src/app/error.tsx logged "No client configured".
 *
 * What leaves the browser is one kind of thing: an error event built by the
 * scrub (src/lib/sentry-scrub.ts), carrying a type, a stack position and the
 * page's route pattern. No breadcrumbs (a click breadcrumb quotes the
 * button's aria-label, which names a student on about 21 controls), no page
 * URL or referrer, no session pings, no client reports, no tracing, no
 * replay. The SDK's integrations are an allowlist (`errorOnlyIntegrations`).
 *
 * Neither the SDK nor the scrub is imported here. Both are fetched as their
 * own chunks once the page has loaded and the browser is idle, so they add
 * nothing to the scripts a page needs before it is interactive; students
 * are on low-end phones and the sign-in page has a weight budget. Errors
 * thrown before they arrive are held (up to MAX_HELD_ERRORS) and sent once
 * they have, and so are errors an error boundary reports through
 * `reportClientError`. What is lost: anything at all if the visitor leaves
 * before the page finishes loading. A root-layout failure during server
 * rendering is still reported by the server (onRequestError in
 * src/instrumentation.ts).
 */
import type { Event as SentryEvent } from "@sentry/nextjs";

const MAX_HELD_ERRORS = 10;
/** The longest an idle browser may keep the SDK waiting after load. */
const IDLE_TIMEOUT_MS = 5_000;

/** The parts of `window` the reporter touches; a test passes a stand-in. */
export interface ReportingPage {
  addEventListener: EventTarget["addEventListener"];
  removeEventListener: EventTarget["removeEventListener"];
  setTimeout: (callback: () => void, ms?: number) => unknown;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown;
  document: { readyState: DocumentReadyState };
  location: { pathname: string };
}

type Report = (thrown: unknown) => void;

interface EarlyErrors {
  held: Error[];
  hold: Report;
  release: () => void;
}

/**
 * What is captured for a thrown value. An Error goes as it is. Anything else
 * (a rejected promise's plain object, a string) becomes an Error that says
 * only what type of value it was: the SDK would otherwise send the whole
 * object as `extra.__serialized__` and a string as the message.
 */
export function reportableError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  const error = new Error("A value that is not an Error was thrown");
  error.name = `NonError_${thrown === null ? "null" : typeof thrown}`;
  return error;
}

/** Set by `startErrorReporting`: holds until the SDK has loaded, captures after. */
let report: Report | undefined;

/**
 * For error boundaries (src/app/error.tsx, src/app/global-error.tsx), which
 * catch an error before any global handler sees it. Same lazy path as every
 * other browser error: held until the SDK has loaded, then captured. With no
 * DSN nothing was started, and this does nothing.
 */
export function reportClientError(thrown: unknown): void {
  report?.(thrown);
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
function holdEarlyErrors(page: ReportingPage): EarlyErrors {
  const held: Error[] = [];
  const hold = (thrown: unknown) => {
    if (held.length < MAX_HELD_ERRORS) held.push(reportableError(thrown));
  };
  const onError = (event: Event) => hold("error" in event ? event.error : event);
  const onRejection = (event: Event) => hold("reason" in event ? event.reason : event);
  page.addEventListener("error", onError);
  page.addEventListener("unhandledrejection", onRejection);
  const release = () => {
    page.removeEventListener("error", onError);
    page.removeEventListener("unhandledrejection", onRejection);
  };
  return { held, hold, release };
}

/**
 * Tags each event with the route pattern of the page it happened on. The
 * SDK's own HttpContext integration is not used: it attaches the full page
 * URL, the referrer and the user agent, and it does so before `beforeSend`
 * has a say, on events that skip `beforeSend` too.
 */
function pageRouteIntegration(page: ReportingPage, routePattern: (path: string) => string) {
  return {
    name: "PageRoute",
    processEvent: (event: SentryEvent): SentryEvent => ({
      ...event,
      tags: { ...event.tags, route: routePattern(page.location.pathname) },
    }),
  };
}

async function loadAndInit(page: ReportingPage, dsn: string, early: EarlyErrors): Promise<Report> {
  // Destructured, so a bundler that tree-shakes dynamic imports keeps only
  // these exports in each chunk.
  const [{ init, captureException }, { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS, routePattern }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/sentry-scrub"),
  ]);
  init({
    dsn,
    environment: process.env.NODE_ENV,
    ...PRIVATE_REPORTING_OPTIONS,
    integrations: (defaults) => [...errorOnlyIntegrations(defaults), pageRouteIntegration(page, routePattern)],
  });
  early.release();
  const capture: Report = (thrown) => {
    captureException(reportableError(thrown));
  };
  for (const error of early.held.splice(0)) capture(error);
  return capture;
}

export function startErrorReporting(page: ReportingPage, dsn: string): void {
  const early = holdEarlyErrors(page);
  report = early.hold;
  afterLoadAndIdle(page, () => {
    loadAndInit(page, dsn, early).then(
      (capture) => {
        report = capture;
      },
      (error: unknown) => {
        early.release();
        report = undefined;
        // The reporter itself failed (an offline phone, a blocked chunk); the
        // console is the only place left to say so.
        console.error("Error reporting could not start", error instanceof Error ? error.name : typeof error);
      },
    );
  });
}

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn && typeof window !== "undefined") startErrorReporting(window, dsn);
