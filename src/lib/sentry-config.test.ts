import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import * as Sentry from "@sentry/nextjs";
import { edgeSentryOptions } from "../../sentry.edge.config";
import { serverSentryOptions } from "../../sentry.server.config";
import { scrubPii, sendNothing } from "./sentry-scrub";
import { insideRequest, type Outbox, PLANTED_REQUEST, plantedIn, settleSdk, startServerSdk, TEST_DSN } from "./sentry.test-support";

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

describe("edge config", () => {
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
