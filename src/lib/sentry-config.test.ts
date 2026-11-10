import assert from "node:assert/strict";
import http from "node:http";
import { before, beforeEach, describe, it } from "node:test";
import * as Sentry from "@sentry/nextjs";
import { edgeSentryOptions } from "../../sentry.edge.config";
import { serverSentryOptions } from "../../sentry.server.config";
import { PRIVATE_REPORTING_OPTIONS, scrubPii, sendNothing } from "./sentry-scrub";
import { insideRequest, type Outbox, PLANTED, PLANTED_REQUEST, plantedIn, settleSdk, startServerSdk, TEST_DSN } from "./sentry.test-support";

// H1 privacy follow-up, item 3 (2026-11-10). The server sampled one request
// in ten as a transaction, and the SDK's HTTP integration read every incoming
// request body in case an event wanted it
// (core/build/cjs/integrations/http/server-subscription.js: the default
// `maxRequestBodySize` is "medium"). These tests start the real SDK with the
// app's own options and drive a real request through it.

let outbox: Outbox;

before(() => {
  outbox = startServerSdk();
});

describe("server config", () => {
  beforeEach(() => outbox.clear());

  it("sets tracing to zero and sends no transaction", () => {
    const options = serverSentryOptions(TEST_DSN);
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.beforeSendTransaction, sendNothing);
  });

  it("scrubs every error, records no breadcrumb, and sends no client report or default PII", () => {
    const options = serverSentryOptions(TEST_DSN);
    assert.equal(options.beforeSend, scrubPii);
    assert.equal(options.beforeBreadcrumb, sendNothing);
    assert.equal(options.maxBreadcrumbs, 0);
    assert.equal(options.sendClientReports, false);
    assert.equal(options.sendDefaultPii, false);
  });

  it("runs only the named integrations: no console, session, context or tracing integration", () => {
    const names = Sentry.getClient()?.getOptions().integrations.map((integration) => integration.name);
    assert.deepEqual(names?.sort(), [
      "FunctionToString",
      "Http",
      "InboundFilters",
      "LinkedErrors",
      "OnUncaughtException",
      "OnUnhandledRejection",
      "RequestData",
    ]);
  });

  it("never reads an incoming request body", async () => {
    let body: unknown = "the handler did not run";
    let url: unknown;
    await insideRequest(async () => {
      const { normalizedRequest } = Sentry.getIsolationScope().getScopeData().sdkProcessingMetadata;
      body = normalizedRequest?.data;
      url = normalizedRequest?.url;
    });
    assert.equal(typeof url, "string", "the SDK did see this request");
    assert.equal(body, undefined);
  });

  it("sends nothing for a request that does not fail: no transaction, session or client report", async () => {
    await insideRequest(async () => undefined);
    await settleSdk();
    assert.deepEqual(outbox.itemTypes(), []);
  });

  it("an error the SDK captures by itself inside a request leaves with the route pattern and no request data", async () => {
    await insideRequest(async () => {
      // What OnUnhandledRejection does (node-core/build/cjs/integrations/onunhandledrejection.js).
      Sentry.captureException(new Error(`no student ${PLANTED_REQUEST.body}`), {
        captureContext: { extra: { unhandledPromiseRejection: true } },
        mechanism: { handled: false, type: "auto.node.onunhandledrejection" },
      });
    });
    await settleSdk();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    assert.deepEqual(plantedIn(outbox.envelopes), []);
    const [event] = outbox.events();
    assert.deepEqual(event?.tags, { route: PLANTED_REQUEST.routePattern, method: "POST" });
    assert.equal(event?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
    assert.equal(event?.request, undefined);
  });

  it("a thrown plain object leaves as a type and a stack, nothing else", async () => {
    Sentry.captureException({ displayName: "Tanesha Rivers", password: "hunter2-Sunset" });
    await settleSdk();
    assert.deepEqual(plantedIn(outbox.envelopes), []);
    const [event] = outbox.events();
    assert.equal(event?.exception?.values?.[0]?.value, "[message withheld]");
    assert.equal(event?.extra, undefined);
  });
});

/** One request to `url` with `node:http`. */
function getWithHttp(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    http.get(url, (reply) => reply.resume().on("end", resolve)).on("error", reject);
  });
}

/** One request to `url` with `fetch`, which is what the app's own outgoing calls use. */
async function getWithFetch(url: string): Promise<void> {
  await (await fetch(url)).text();
}

/** The headers a loopback server receives from one request made here by `send`. */
async function headersOfOutgoingRequest(send: (url: string) => Promise<void> = getWithHttp): Promise<http.IncomingHttpHeaders> {
  let received: http.IncomingHttpHeaders = {};
  const server = http.createServer((incoming, response) => {
    received = incoming.headers;
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;
  try {
    await send(`http://127.0.0.1:${port}/api/partner/lookup`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return received;
}

// Third pass, item 2 (2026-11-10). Two things the SDK sends without asking
// `beforeSend`, both on unless they are turned off
// (@sentry/core build/cjs/client.js, the constructor: `enableLogs ... ?? true`
// and `enableMetrics ... ?? true`), and the trace headers its HTTP integration
// adds to the server's own outgoing requests
// (core/build/cjs/integrations/http/inject-trace-propagation-headers.js, which
// attaches them to every URL when `tracePropagationTargets` is not set).
describe("what the SDK would send without asking beforeSend", () => {
  beforeEach(() => outbox.clear());

  it("logs and metrics are off in the options every runtime spreads", () => {
    assert.equal(PRIVATE_REPORTING_OPTIONS.enableLogs, false);
    assert.equal(PRIVATE_REPORTING_OPTIONS.enableMetrics, false);
  });

  it("logs and metrics are off on the built server client", () => {
    const options = Sentry.getClient()?.getOptions();
    assert.equal(options?.enableLogs, false);
    assert.equal(options?.enableMetrics, false);
  });

  it("a log line and a metric build no envelope at all", async () => {
    const built: string[] = [];
    const stop = Sentry.getClient()?.on("beforeEnvelope", (envelope) => {
      built.push(...envelope[1].map((item) => item[0].type));
    });
    Sentry.logger.info(`looked up ${PLANTED.email}`);
    Sentry.metrics.count(`notes_saved_${PLANTED.loginId}`, 1);
    await settleSdk();
    stop?.();
    assert.deepEqual(built, []);
    assert.deepEqual(outbox.itemTypes(), []);
  });

  // Spotlight is a local debugging sidecar. When it is on, the SDK posts
  // every envelope to it from the beforeEnvelope hook, before the wire filter
  // and unscrubbed (@sentry/node-core build/cjs/integrations/spotlight.js).
  // SENTRY_SPOTLIGHT in the environment turns it on unless the option is
  // exactly false (node-core build/cjs/utils/spotlight.js).
  // The option is a Node SDK option; the types this file sees do not list it.
  const spotlightOf = (options: object): unknown => ("spotlight" in options ? options.spotlight : undefined);

  it("Spotlight is off in the server options whatever the environment says", () => {
    const before = process.env.SENTRY_SPOTLIGHT;
    process.env.SENTRY_SPOTLIGHT = "1";
    try {
      assert.equal(spotlightOf(serverSentryOptions(TEST_DSN)), false);
    } finally {
      if (before === undefined) delete process.env.SENTRY_SPOTLIGHT;
      else process.env.SENTRY_SPOTLIGHT = before;
    }
    assert.equal(spotlightOf(Sentry.getClient()?.getOptions() ?? {}), false);
  });

  it("the built server client names no host to receive its trace headers", () => {
    assert.deepEqual(serverSentryOptions(TEST_DSN).tracePropagationTargets, []);
    assert.deepEqual(Sentry.getClient()?.getOptions().tracePropagationTargets, []);
  });

  it("an outgoing node:http request carries no sentry-trace, baggage or traceparent header", async () => {
    const headers = await headersOfOutgoingRequest();
    assert.equal(headers.host?.startsWith("127.0.0.1:"), true, "the request arrived");
    assert.deepEqual([headers["sentry-trace"], headers.baggage, headers.traceparent], [undefined, undefined, undefined]);
  });

  it("nor does one made while the server is handling a request", async () => {
    let headers: http.IncomingHttpHeaders = {};
    await insideRequest(async () => {
      headers = await headersOfOutgoingRequest();
    });
    assert.equal(headers.host?.startsWith("127.0.0.1:"), true, "the request arrived");
    assert.deepEqual([headers["sentry-trace"], headers.baggage, headers.traceparent], [undefined, undefined, undefined]);
  });

  // Unlike the two above, this passes with or without the option today: no
  // integration the app keeps instruments `fetch`. It is here because the
  // app's own outgoing calls use `fetch`, so adding such an integration back
  // would show up.
  it("nor does an outgoing fetch, inside a request or outside one", async () => {
    const seen: http.IncomingHttpHeaders[] = [await headersOfOutgoingRequest(getWithFetch)];
    await insideRequest(async () => {
      seen.push(await headersOfOutgoingRequest(getWithFetch));
    });
    assert.equal(seen.length, 2);
    for (const headers of seen) {
      assert.equal(headers.host?.startsWith("127.0.0.1:"), true, "the request arrived");
      assert.deepEqual([headers["sentry-trace"], headers.baggage, headers.traceparent], [undefined, undefined, undefined]);
    }
  });
});

describe("edge config", () => {
  it("turns logs and metrics off and names no host to receive trace headers", () => {
    const options = edgeSentryOptions(TEST_DSN);
    assert.equal(options.enableLogs, false);
    assert.equal(options.enableMetrics, false);
    assert.deepEqual(options.tracePropagationTargets, []);
  });

  it("sets tracing to zero and spreads the same private options", () => {
    const options = edgeSentryOptions(TEST_DSN);
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.beforeSend, scrubPii);
    assert.equal(options.beforeSendTransaction, sendNothing);
    assert.equal(options.beforeBreadcrumb, sendNothing);
    assert.equal(options.maxBreadcrumbs, 0);
    assert.equal(options.sendClientReports, false);
    assert.equal(options.sendDefaultPii, false);
  });

  it("keeps an integration only when it is named", () => {
    const { integrations } = edgeSentryOptions(TEST_DSN);
    assert.equal(typeof integrations, "function");
    const kept = typeof integrations === "function" ? integrations([{ name: "LinkedErrors" }, { name: "WinterCGFetch" }, { name: "Console" }]) : [];
    assert.deepEqual(kept, [{ name: "LinkedErrors" }]);
  });
});
