import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import * as Browser from "@sentry/browser";
import { PRIVATE_REPORTING_OPTIONS, scrubPii } from "@/lib/sentry-scrub";
import {
  type Envelope,
  envelopeItems,
  envelopeOf,
  eventsIn,
  hostileEnvelope,
  PLANTED,
  plantedIn,
  sdkBreadcrumbs,
  TEST_DSN,
  wireText,
} from "@/lib/sentry.test-support";

// H1 (2026-11-10): the browser had no Sentry client at all. The SDK reads
// sentry.client.config.ts only on its webpack path
// (node_modules/@sentry/nextjs/build/cjs/config/webpack.js), and `next build`
// on Next 16 runs Turbopack, so src/app/error.tsx logged "No client
// configured". src/instrumentation-client.ts is the file Next itself loads.
// It loads the SDK after the page has loaded, so the SDK costs nothing before
// the page is interactive, and it holds the errors thrown before then.
//
// Privacy follow-up, items 1, 4, 6 and 13: the first init kept the SDK's
// breadcrumb, session and page-context integrations. These tests start the
// REAL browser client (@sentry/browser, which the Next SDK's browser `init`
// wraps) with the options the app passes and a transport that records, and
// assert on what was handed to that transport.
//
// Third pass: the recording transport stands where the SDK's fetch transport
// does (`makeFetchTransport`), so the app's wire filter
// (src/lib/sentry-wire.ts) is in front of it and `envelopes` holds what the
// browser would post. The app's `transport` option is passed to the SDK as
// it is.

type BrowserOptions = NonNullable<Parameters<typeof Browser.init>[0]>;
type Transport = ReturnType<NonNullable<BrowserOptions["transport"]>>;

const envelopes: Envelope[] = [];
const recordingTransport = (): Transport => ({
  send: async (envelope: Envelope) => {
    envelopes.push(envelope);
    return {};
  },
  flush: async () => true,
});

// The fallback is there so that a test run can never reach the network: if
// the app passed no transport, the SDK would use its real one.
const init = mock.fn((options: BrowserOptions) => Browser.init({ ...options, transport: options.transport ?? recordingTransport }));
const captureException = mock.fn((error: unknown) => Browser.captureException(error));
mock.module("@sentry/nextjs", { namedExports: { init, captureException, makeFetchTransport: recordingTransport } });
mock.method(console, "error", () => {});

let client: typeof import("./instrumentation-client");
let initCallsAtImport = -1;

before(async () => {
  client = await import("./instrumentation-client");
  await settle();
  initCallsAtImport = init.mock.callCount();
});

/** A page as far as the reporter can see one. */
function fakePage(readyState: DocumentReadyState, pathname = `/credentials/${PLANTED.slug}`) {
  const target = new EventTarget();
  const timers: (() => void)[] = [];
  const page = Object.assign(target, {
    document: { readyState },
    location: { pathname },
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  });
  return { page, runTimers: () => timers.splice(0).forEach((callback) => callback()) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await Browser.flush(2_000);
}

/** Starts reporting on a page that has finished loading, and waits for the SDK. */
async function startedPage(pathname?: string) {
  const { page, runTimers } = fakePage("complete", pathname);
  client.startErrorReporting(page, TEST_DSN);
  runTimers();
  await settle();
  return page;
}

function errorEvent(error: unknown): Event {
  return Object.assign(new Event("error"), { error });
}

function itemTypes(): string[] {
  return envelopes.flatMap(envelopeItems).map(([type]) => type);
}

function sentEvents() {
  return eventsIn(envelopes);
}

function initOptions(): BrowserOptions {
  const options = init.mock.calls[0]?.arguments[0];
  assert.ok(options, "init was not called");
  return options;
}

beforeEach(() => {
  init.mock.resetCalls();
  captureException.mock.resetCalls();
  envelopes.length = 0;
});

describe("startErrorReporting", () => {
  it("waits for the page to load before loading the SDK", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, TEST_DSN);
    runTimers();
    await settle();
    assert.equal(init.mock.callCount(), 0);

    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.equal(init.mock.callCount(), 1);
  });

  it("reports an error thrown before the SDK loaded", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, TEST_DSN);
    const early = new Error("hydration failed");
    page.dispatchEvent(errorEvent(early));
    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.equal(captureException.mock.callCount(), 1);
    assert.equal(captureException.mock.calls[0]?.arguments[0], early);
  });

  it("stops holding errors once the SDK has its own handlers", async () => {
    const page = await startedPage();
    page.dispatchEvent(errorEvent(new Error("later")));
    await settle();
    assert.equal(captureException.mock.callCount(), 0);
  });
});

describe("what the browser init passes the SDK", () => {
  it("spreads the private options: scrub, no breadcrumbs, no client reports, no tracing, no replay", async () => {
    await startedPage();
    const options = initOptions();
    assert.equal(options.dsn, TEST_DSN);
    assert.equal(options.beforeSend, PRIVATE_REPORTING_OPTIONS.beforeSend);
    assert.equal(options.beforeSendTransaction, PRIVATE_REPORTING_OPTIONS.beforeSendTransaction);
    assert.equal(options.beforeBreadcrumb, PRIVATE_REPORTING_OPTIONS.beforeBreadcrumb);
    assert.equal(options.maxBreadcrumbs, 0);
    assert.equal(options.sendClientReports, false);
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.tracesSampleRate, undefined);
    assert.equal(options.replaysSessionSampleRate, undefined);
    assert.equal(options.replaysOnErrorSampleRate, undefined);
  });

  it("keeps no breadcrumbs, session, page-context or tracing integration from the SDK's real defaults", async () => {
    await startedPage();
    const { integrations } = initOptions();
    assert.equal(typeof integrations, "function");
    // The browser SDK's own list, plus the two the Next SDK adds
    // (nextjs/build/cjs/client/index.js `getDefaultIntegrations`).
    const offered = [...Browser.getDefaultIntegrations({}), { name: "BrowserTracing" }, { name: "NextjsClientStackFrameNormalization" }];
    const offeredNames = offered.map((integration) => integration.name);
    for (const name of ["Breadcrumbs", "BrowserSession", "HttpContext"]) assert.ok(offeredNames.includes(name), `the SDK no longer offers ${name}`);

    const kept = typeof integrations === "function" ? integrations(offered).map((integration) => integration.name) : [];
    assert.deepEqual(kept.sort(), [
      "Dedupe",
      "FunctionToString",
      "GlobalHandlers",
      "InboundFilters",
      "LinkedErrors",
      "NextjsClientStackFrameNormalization",
      "PageRoute",
    ]);
  });
});

describe("what leaves the browser", () => {
  it("an error leaves as one event: no session ping, no client report", async () => {
    await startedPage();
    client.reportClientError(new Error(`could not save ${PLANTED.name}`));
    await settle();
    assert.deepEqual(itemTypes(), ["event"]);
  });

  it("names the page by its route pattern, with no URL, referrer or message", async () => {
    await startedPage(`/credentials/${PLANTED.slug}`);
    client.reportClientError(new Error(`could not save ${PLANTED.name} (${PLANTED.loginId})`));
    await settle();
    const [event] = sentEvents();
    assert.deepEqual(plantedIn(envelopes), []);
    assert.deepEqual(event?.tags, { route: "/credentials/[param]" });
    assert.equal(event?.request, undefined);
    assert.equal(event?.exception?.values?.[0]?.value, "[message withheld]");
  });

  it("records no breadcrumb, from the SDK's own hooks or from a direct call", async () => {
    await startedPage();
    Browser.addBreadcrumb(sdkBreadcrumbs.click());
    Browser.addBreadcrumb(sdkBreadcrumbs.fetch());
    console.error("save failed", { displayName: PLANTED.name, message: PLANTED.chat });
    client.reportClientError(new Error("boom"));
    await settle();
    assert.deepEqual(plantedIn(envelopes), []);
    assert.equal(sentEvents()[0]?.breadcrumbs, undefined);
    assert.deepEqual(Browser.getIsolationScope().getScopeData().breadcrumbs, []);
  });

  it("a thrown value that is not an Error is reported by its type only", async () => {
    await startedPage();
    client.reportClientError({ displayName: PLANTED.name, password: PLANTED.password });
    client.reportClientError(PLANTED.chat);
    await settle();
    assert.deepEqual(plantedIn(envelopes), []);
    assert.deepEqual(
      sentEvents().map((event) => event.exception?.values?.[0]?.type),
      ["NonError_object", "NonError_string"],
    );
    assert.ok(sentEvents().every((event) => event.extra === undefined));
  });

  it("a non-Error value held before the SDK loaded is converted too", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, TEST_DSN);
    page.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: { displayName: PLANTED.name } }));
    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.deepEqual(plantedIn(envelopes), []);
    assert.equal(sentEvents()[0]?.exception?.values?.[0]?.type, "NonError_object");
  });
});

// Third pass: `beforeSend` is not the last word. The SDK skips it for the
// report about its own failure, and never calls it for a session, a client
// report, a log or an attachment. The browser's transport is behind the wire
// filter, which rebuilds every envelope.
describe("the wire filter in the browser", () => {
  const HEADER_KEYS = ["event_id", "sdk", "sent_at"];

  it("the app passes the SDK a transport of its own", async () => {
    await startedPage();
    assert.equal(typeof initOptions().transport, "function");
  });

  it("the built client's transport sends only the scrubbed event of a mixed envelope, under a three-key header", async () => {
    await startedPage();
    const hostile = hostileEnvelope();
    await Browser.getClient()?.getTransport()?.send(hostile);
    assert.deepEqual(itemTypes(), ["event"]);
    assert.deepEqual(envelopes.map((envelope) => Object.keys(envelope[0]).sort()), [HEADER_KEYS]);
    assert.deepEqual(sentEvents(), eventsIn([hostile]).map((event) => scrubPii(event)));
    assert.deepEqual(plantedIn(wireText(envelopes)), []);
  });

  it("an envelope that holds no event is not sent at all", async () => {
    await startedPage();
    await Browser.getClient()?.getTransport()?.send(envelopeOf(["session", "client_report", "attachment", "log"]));
    assert.equal(envelopes.length, 0);
  });

  it("an event processor that throws leaves a scrubbed report of the SDK's own failure", async () => {
    await startedPage(`/credentials/${PLANTED.slug}`);
    Browser.withScope((scope) => {
      scope.addEventProcessor(() => {
        throw new Error(`processor failed for ${PLANTED.name}`);
      });
      client.reportClientError(new Error(`could not save ${PLANTED.name}`));
    });
    await settle();
    const wire = wireText(envelopes);
    assert.deepEqual(plantedIn(wire), []);
    assert.ok(!wire.includes("processor failed") && !wire.includes("could not save"));
    assert.deepEqual(envelopes.map((envelope) => Object.keys(envelope[0]).sort()), [HEADER_KEYS]);
    assert.deepEqual(
      sentEvents().map((event) => event.exception?.values?.map((entry) => [entry.value, entry.mechanism?.type])),
      [[["[message withheld]", "internal"]]],
    );
  });
});

describe("reportClientError, for error boundaries", () => {
  it("holds an error reported before the SDK has loaded, and sends it once it has", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, TEST_DSN);
    client.reportClientError(new Error("the boundary caught this first"));
    assert.equal(captureException.mock.callCount(), 0);
    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.equal(captureException.mock.callCount(), 1);
    assert.deepEqual(itemTypes(), ["event"]);
  });
});

describe("with no DSN", () => {
  it("importing the module starts nothing", () => {
    assert.equal(process.env.NEXT_PUBLIC_SENTRY_DSN, undefined);
    assert.equal(initCallsAtImport, 0);
  });
});
