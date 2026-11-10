import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { scrubPii } from "@/lib/sentry-scrub";

// H1 (2026-11-10): the browser had no Sentry client at all. The SDK reads
// sentry.client.config.ts only on its webpack path
// (node_modules/@sentry/nextjs/build/cjs/config/webpack.js), and `next build`
// on Next 16 runs Turbopack, so src/app/error.tsx logged "No client
// configured". src/instrumentation-client.ts is the file Next itself loads.
// It loads the SDK after the page has loaded, so the SDK costs nothing before
// the page is interactive, and it holds the errors thrown before then.

interface InitOptions {
  dsn?: string;
  beforeSend?: unknown;
  beforeSendTransaction?: unknown;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  integrations?: (defaults: { name: string }[]) => { name: string }[];
}

const init = mock.fn((_options: InitOptions) => undefined);
const captureException = mock.fn((_error: unknown) => "event-id");
mock.module("@sentry/nextjs", { namedExports: { init, captureException } });

let client: typeof import("./instrumentation-client");
let initCallsAtImport = -1;

before(async () => {
  client = await import("./instrumentation-client");
  await settle();
  initCallsAtImport = init.mock.callCount();
});

const DSN = "https://public@o0.ingest.sentry.io/0";

/** A page as far as the reporter can see one. */
function fakePage(readyState: DocumentReadyState) {
  const target = new EventTarget();
  const timers: (() => void)[] = [];
  const page = Object.assign(target, {
    document: { readyState },
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  });
  return { page, runTimers: () => timers.splice(0).forEach((callback) => callback()) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function errorEvent(error: Error): Event {
  return Object.assign(new Event("error"), { error, message: error.message });
}

describe("startErrorReporting", () => {
  beforeEach(() => {
    init.mock.resetCalls();
    captureException.mock.resetCalls();
  });

  it("waits for the page to load before loading the SDK", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, DSN);
    runTimers();
    await settle();
    assert.equal(init.mock.callCount(), 0);

    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.equal(init.mock.callCount(), 1);
  });

  it("initialises errors only, through the scrub", async () => {
    const { page, runTimers } = fakePage("complete");
    client.startErrorReporting(page, DSN);
    runTimers();
    await settle();
    const options = init.mock.calls[0]?.arguments[0];
    assert.equal(options?.dsn, DSN);
    assert.equal(options?.beforeSend, scrubPii);
    assert.equal(options?.beforeSendTransaction, scrubPii);
    assert.equal(options?.tracesSampleRate, undefined);
    assert.equal(options?.replaysSessionSampleRate, undefined);
    assert.equal(options?.replaysOnErrorSampleRate, undefined);
    const kept = options?.integrations?.([{ name: "BrowserTracing" }, { name: "Replay" }, { name: "GlobalHandlers" }]);
    assert.deepEqual(kept, [{ name: "GlobalHandlers" }]);
  });

  it("reports an error thrown before the SDK loaded", async () => {
    const { page, runTimers } = fakePage("loading");
    client.startErrorReporting(page, DSN);
    const early = new Error("hydration failed");
    page.dispatchEvent(errorEvent(early));
    page.dispatchEvent(new Event("load"));
    runTimers();
    await settle();
    assert.equal(captureException.mock.callCount(), 1);
    assert.equal(captureException.mock.calls[0]?.arguments[0], early);
  });

  it("stops holding errors once the SDK has its own handlers", async () => {
    const { page, runTimers } = fakePage("complete");
    client.startErrorReporting(page, DSN);
    runTimers();
    await settle();
    page.dispatchEvent(errorEvent(new Error("later")));
    await settle();
    assert.equal(captureException.mock.callCount(), 0);
  });
});

describe("with no DSN", () => {
  it("importing the module starts nothing", () => {
    assert.equal(process.env.NEXT_PUBLIC_SENTRY_DSN, undefined);
    assert.equal(initCallsAtImport, 0);
  });
});
