import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import * as Sentry from "@sentry/nextjs";
import { edgeSentryOptions } from "../../sentry.edge.config";
import { serverSentryOptions } from "../../sentry.server.config";
import { scrubPii } from "./sentry-scrub";
import { allowlistedEnvelope, type Envelope, type Transport, wireAllowlistTransport } from "./sentry-wire";
import {
  envelopeOf,
  eventsIn,
  hostileEnvelope,
  insideRequest,
  type Outbox,
  PLANTED,
  PLANTED_REQUEST,
  plantedIn,
  recordingTransport,
  settleSdk,
  startServerSdk,
  TEST_DSN,
  wireText,
} from "./sentry.test-support";

// H1 third pass (2026-11-10). A second privacy audit ran the real SDK and
// found one path past the scrub: the report the SDK sends about its OWN
// failure. When an event processor, an integration or `beforeSend` throws,
// the SDK captures the throw with `data: { __sentry__: true }`, and for that
// hint `_processEvent` returns the prepared event without calling
// `beforeSend` (node_modules/@sentry/core/build/cjs/client.js, about lines
// 590 to 660). What left: the raw error text, the transaction named after the
// real path, `server_name`, the `trace` envelope header and unscrubbed frames.
//
// The allowlist is at the wire now. Every envelope a transport is handed is
// rebuilt first (src/lib/sentry-wire.ts): an `event` item is scrubbed again,
// every other item is dropped, and the header keeps three keys.

const HEADER_KEYS = ["event_id", "sdk", "sent_at"];
const MIXED_ITEMS = ["event", "attachment", "session", "client_report", "log"];
const SDK_HEADER = { name: "sentry.javascript.nextjs", version: "10.76.2" };

type ItemType = Envelope[1][number][0]["type"];

/**
 * Every item type an envelope of the installed SDK can hold
 * (@sentry/core build/types/types/envelope.d.ts), bar `event`. The record's
 * key type is read off the SDK's own `Envelope` type, so an item a later SDK
 * version adds fails to compile here until it is named. `EnvelopeItemType`
 * there also lists `metric`, which no envelope of this version carries; it
 * is tested below with the types the SDK does not have.
 */
const NOT_SENT: Record<Exclude<ItemType, "event">, string> = {
  transaction: "a traced request: its name, its spans and their URLs",
  span: "one span, or a container of streamed spans",
  session: "one visit or request counted, with a distinct id",
  sessions: "request counts in one-minute buckets",
  client_report: "counts of what the SDK dropped",
  attachment: "a file attached to an event",
  user_report: "a visitor's name, email and comment",
  feedback: "a visitor's message, with the page URL",
  profile: "a CPU profile of a transaction",
  profile_chunk: "a continuous CPU profile",
  replay_event: "a session replay's metadata, with URLs",
  replay_recording: "a session replay's recording of the page",
  check_in: "a cron monitor ping",
  log: "structured log lines",
  trace_metric: "metric values",
  raw_security: "a browser's CSP violation report, with URLs",
};

function header(envelope: Envelope | null): Record<string, unknown> {
  assert.ok(envelope, "the envelope was not sent");
  return { ...envelope[0] };
}

function itemHeaders(envelope: Envelope | null): unknown[] {
  assert.ok(envelope, "the envelope was not sent");
  return envelope[1].map((item) => item[0]);
}

/** A transport's own options, as the SDK passes them (client.js, the constructor). Nothing listens at this address. */
const TRANSPORT_OPTIONS = { url: "http://127.0.0.1:9/api/456/envelope/", recordDroppedEvent: () => {} };

describe("the wire filter", () => {
  it("keeps the event of a mixed envelope and drops every other item", () => {
    const hostile = hostileEnvelope();
    assert.deepEqual(hostile[1].map((item) => item[0].type), MIXED_ITEMS, "the fixture holds one of each");
    assert.deepEqual(itemHeaders(allowlistedEnvelope(hostile)), [{ type: "event" }]);
  });

  it("scrubs the event again, as if beforeSend had never seen it", () => {
    const [unscrubbed] = eventsIn([hostileEnvelope()]);
    assert.ok(unscrubbed?.request?.data, "the fixture's event is not scrubbed");
    const sent = allowlistedEnvelope(hostileEnvelope());
    assert.ok(sent);
    assert.deepEqual(eventsIn([sent]), [scrubPii(unscrubbed)]);
    assert.equal(eventsIn([sent])[0]?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
  });

  // The SDK tells Sentry not to take an IP address from the connection with
  // `sdk.settings.infer_ip: "never"`, and it writes that AFTER `beforeSend`
  // (@sentry/core envelope.js `createEventEnvelope`). The second scrub is the
  // one that decides whether it is sent. In the browser the connection's
  // address is the student's.
  it("always tells Sentry not to take an IP address from the connection", () => {
    const hostile = hostileEnvelope();
    assert.equal(eventsIn([hostile])[0]?.sdk?.settings?.infer_ip, "auto", "the fixture asks Sentry to infer one");
    const sent = allowlistedEnvelope(hostile);
    assert.ok(sent);
    assert.deepEqual(eventsIn([sent])[0]?.sdk?.settings, { infer_ip: "never" });
  });

  it("rebuilds the header with three keys: no trace, no DSN", () => {
    const hostile = hostileEnvelope();
    assert.deepEqual(Object.keys(hostile[0]).sort(), ["dsn", "event_id", "sdk", "sent_at", "trace"], "the fixture's header");
    const sent = header(allowlistedEnvelope(hostile));
    assert.deepEqual(Object.keys(sent).sort(), HEADER_KEYS);
    assert.deepEqual(sent, { event_id: hostile[0].event_id, sent_at: hostile[0].sent_at, sdk: SDK_HEADER });
  });

  it("leaves nothing planted in the bytes that would be sent", () => {
    assert.notDeepEqual(plantedIn(wireText([hostileEnvelope()])), [], "the fixture carries planted data");
    const sent = allowlistedEnvelope(hostileEnvelope());
    assert.ok(sent);
    assert.deepEqual(plantedIn(wireText([sent])), []);
  });

  for (const [type, what] of Object.entries(NOT_SENT)) {
    it(`does not send a ${type} item (${what})`, () => {
      assert.equal(allowlistedEnvelope(envelopeOf([type])), null);
    });
  }

  it("does not send an item type no envelope of this SDK carries, or one it does not have yet", () => {
    assert.equal(allowlistedEnvelope(envelopeOf(["metric"])), null);
    assert.equal(allowlistedEnvelope(envelopeOf(["a_kind_from_a_later_sdk"])), null);
  });

  it("does not send an event item whose payload is a transaction, text or nothing", () => {
    const head = { event_id: "5a5f9020952246c684cc5e9358089b1e", sent_at: "2026-11-10T21:00:00.000Z" };
    const withPayload = (payload: unknown): Envelope => [head, [[{ type: "event" }, Object(payload)]]];
    assert.equal(allowlistedEnvelope(withPayload({ type: "transaction", transaction: `GET /credentials/${PLANTED.slug}` })), null);
    assert.equal(allowlistedEnvelope(withPayload(`{"message":"${PLANTED.chat}"}`)), null);
    assert.equal(allowlistedEnvelope(withPayload(new TextEncoder().encode(PLANTED.chat))), null);
    assert.equal(allowlistedEnvelope([head, []]), null);
  });

  it("keeps an sdk header only when its name and version are plain labels", () => {
    const event = { event_id: "5a5f9020952246c684cc5e9358089b1e", message: "boot_probe_failed", tags: { alert: "boot_probe_failed" } };
    const withSdk = (sdk: object): Envelope => [{ event_id: event.event_id, sent_at: "2026-11-10T21:00:00.000Z", sdk }, [[{ type: "event" }, event]]];
    assert.deepEqual(header(allowlistedEnvelope(withSdk({ ...SDK_HEADER, settings: { infer_ip: "auto" } }))).sdk, SDK_HEADER);
    assert.equal(header(allowlistedEnvelope(withSdk({ name: `sdk of ${PLANTED.name}`, version: "1" }))).sdk, undefined);
    assert.equal(header(allowlistedEnvelope(withSdk({ name: "sentry.javascript.nextjs" }))).sdk, undefined);
  });

  it("does not send an envelope whose event id or send time is not in the SDK's form", () => {
    const event = { message: "boot_probe_failed", tags: { alert: "boot_probe_failed" } };
    const under = (head: { event_id: string; sent_at: string }): Envelope => [head, [[{ type: "event" }, event]]];
    const good = { event_id: "5a5f9020952246c684cc5e9358089b1e", sent_at: "2026-11-10T21:00:00.000Z" };
    assert.ok(allowlistedEnvelope(under(good)));
    assert.equal(allowlistedEnvelope(under({ ...good, event_id: PLANTED.recordId })), null);
    assert.equal(allowlistedEnvelope(under({ ...good, sent_at: `today, for ${PLANTED.name}` })), null);
  });
});

describe("a transport behind the wire filter", () => {
  it("is handed the rebuilt envelope, and its answer is passed back", async () => {
    const sent: Envelope[] = [];
    const base: Transport = {
      send: async (envelope) => {
        sent.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    };
    const transport = wireAllowlistTransport(() => base)(TRANSPORT_OPTIONS);
    const hostile = hostileEnvelope();
    assert.deepEqual(await transport.send(hostile), { statusCode: 200 });
    assert.deepEqual(sent.map(itemHeaders), [[{ type: "event" }]]);
    assert.deepEqual(sent, [allowlistedEnvelope(hostile)]);
    assert.deepEqual(hostile[1].map((item) => item[0].type), MIXED_ITEMS, "the SDK's envelope is left as it was");
  });

  it("is not called at all for an envelope with no event in it", async () => {
    const recorded = recordingTransport();
    const transport = wireAllowlistTransport(recorded.make)(TRANSPORT_OPTIONS);
    assert.deepEqual(await transport.send(envelopeOf(["session", "client_report", "attachment", "log"])), {});
    assert.equal(recorded.envelopes.length, 0);
  });

  it("is never handed something that is not an envelope", async () => {
    const recorded = recordingTransport();
    const transport = wireAllowlistTransport(recorded.make)(TRANSPORT_OPTIONS);
    const broken: unknown[] = [null, PLANTED.chat, [], [null, null], [{}, PLANTED.chat], [{}, [null]], [{}, [[null, null]]]];
    const never = new Proxy([], {
      get: () => {
        throw new Error(PLANTED.name);
      },
    });
    for (const envelope of [...broken, never]) {
      // Whether the filter answers or refuses, the transport saw nothing.
      await Reflect.apply(transport.send, transport, [envelope]).then(undefined, () => undefined);
    }
    assert.equal(recorded.envelopes.length, 0);
  });

  it("is built with the options the SDK gave, and flushes when asked", async () => {
    const flush = mock.fn(async (_timeout?: number) => true);
    const make = mock.fn((_options: typeof TRANSPORT_OPTIONS): Transport => ({ send: async () => ({}), flush }));
    const transport = wireAllowlistTransport(make)(TRANSPORT_OPTIONS);
    assert.equal(make.mock.calls[0]?.arguments[0], TRANSPORT_OPTIONS);
    assert.equal(await transport.flush(1_500), true);
    assert.deepEqual(flush.mock.calls[0]?.arguments, [1_500]);
  });
});

/** Sends the hostile envelope and one with no event through `transport`, and checks what `recorded` was handed. */
async function assertFilters(transport: Transport | undefined, recorded: { envelopes: Envelope[] }): Promise<void> {
  assert.ok(transport, "there is no transport to send through");
  recorded.envelopes.length = 0;
  await transport.send(envelopeOf(["session", "client_report", "attachment", "log"]));
  assert.equal(recorded.envelopes.length, 0, "an envelope with no event was sent");
  await transport.send(hostileEnvelope());
  assert.equal(recorded.envelopes.length, 1);
  const [sent] = recorded.envelopes;
  assert.deepEqual(itemHeaders(sent ?? null), [{ type: "event" }]);
  assert.deepEqual(Object.keys(header(sent ?? null)).sort(), HEADER_KEYS);
  assert.deepEqual(eventsIn(recorded.envelopes), eventsIn([hostileEnvelope()]).map((event) => scrubPii(event)));
  assert.deepEqual(plantedIn(wireText(recorded.envelopes)), []);
}

let outbox: Outbox;

before(() => {
  outbox = startServerSdk();
});

describe("the wire filter in each runtime", () => {
  it("server: the built client's own transport filters", async () => {
    await assertFilters(Sentry.getClient()?.getTransport(), outbox);
  });

  it("server: the options wrap the transport they are given", async () => {
    const recorded = recordingTransport();
    const make = serverSentryOptions(TEST_DSN, recorded.make).transport;
    assert.equal(typeof make, "function", "serverSentryOptions sets no transport");
    await assertFilters(make?.(TRANSPORT_OPTIONS), recorded);
  });

  it("edge: the options wrap the transport they are given", async () => {
    const recorded = recordingTransport();
    const make = edgeSentryOptions(TEST_DSN, recorded.make).transport;
    assert.equal(typeof make, "function", "edgeSentryOptions sets no transport");
    await assertFilters(make?.(TRANSPORT_OPTIONS), recorded);
  });
});

// With no transport passed in, each runtime's options wrap the transport the
// app really uses. These read the request body it makes.
describe("the bytes each runtime's own transport sends", () => {
  /** A loopback server that keeps every request body. */
  const bodies: string[] = [];
  const server = http.createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      response.end("{}");
    });
  });
  let port = 0;
  const noProxyBefore = process.env.no_proxy;

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    port = address !== null && typeof address !== "string" ? address.port : 0;
    // The SDK's Node transport reads the proxy from the environment
    // (node-core/build/cjs/transports/http.js); loopback goes direct.
    process.env.no_proxy = "127.0.0.1";
  });
  after(async () => {
    if (noProxyBefore === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = noProxyBefore;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    bodies.length = 0;
  });

  function assertBody(body: string | undefined): void {
    assert.ok(body, "no request was made");
    const lines = body.split("\n");
    assert.equal(lines.length, 3, "a header, one item header and one payload");
    assert.deepEqual(Object.keys(JSON.parse(lines[0] ?? "{}")).sort(), HEADER_KEYS);
    assert.deepEqual(JSON.parse(lines[1] ?? "{}"), { type: "event" });
    assert.deepEqual(plantedIn(body), []);
    assert.ok(!body.includes("server_name") && !body.includes("resume"));
  }

  it("server: the SDK's Node transport posts the rebuilt envelope and nothing else", async () => {
    const make = serverSentryOptions(`http://public@127.0.0.1:${port}/456`).transport;
    assert.equal(typeof make, "function", "serverSentryOptions sets no transport");
    const transport = make?.({ url: `http://127.0.0.1:${port}/api/456/envelope/`, recordDroppedEvent: () => {} });
    await transport?.send(envelopeOf(["session", "client_report", "attachment", "log"]));
    await transport?.send(hostileEnvelope());
    await transport?.flush(2_000);
    assert.equal(bodies.length, 1);
    assertBody(bodies[0]);
  });

  it("edge: the fetch transport posts the rebuilt envelope and nothing else", async (t) => {
    const posted: { url: string; method?: string; body: string }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      posted.push({ url: String(url), method: init?.method, body: String(init?.body) });
      return new Response(null, { status: 200 });
    });
    const make = edgeSentryOptions(TEST_DSN).transport;
    assert.equal(typeof make, "function", "edgeSentryOptions sets no transport");
    const transport = make?.({ url: "https://edge.invalid/api/456/envelope/", recordDroppedEvent: () => {} });
    await transport?.send(envelopeOf(["session", "client_report", "attachment", "log"]));
    await transport?.send(hostileEnvelope());
    await transport?.flush(2_000);
    assert.deepEqual(posted.map(({ url, method }) => ({ url, method })), [{ url: "https://edge.invalid/api/456/envelope/", method: "POST" }]);
    assertBody(posted[0]?.body);
  });
});

// The audit's reproductions, run through the real server SDK inside a real
// request to /api/teacher/students/<record id>/notes.
describe("a report the SDK sends about its own failure", () => {
  beforeEach(() => outbox.clear());

  /** Nothing of the request, the host or the thrown text, and three header keys. */
  function assertNothingLeaked(): string {
    const wire = wireText(outbox.envelopes);
    assert.deepEqual(plantedIn(wire), []);
    for (const leaked of ["?q=", "127.0.0.1", "server_name", os.hostname(), "processor failed", "no student", "vq-session"]) {
      assert.ok(!wire.toLowerCase().includes(leaked.toLowerCase()), `the envelope holds "${leaked}"`);
    }
    for (const envelope of outbox.envelopes) assert.deepEqual(Object.keys(envelope[0]).sort(), HEADER_KEYS);
    return wire;
  }

  it("an event processor that throws inside a request leaves a scrubbed report, with no trace header", async () => {
    await insideRequest(async () => {
      Sentry.withScope((scope) => {
        scope.addEventProcessor(() => {
          throw new Error(`processor failed for ${PLANTED.name}`);
        });
        Sentry.captureException(new Error(`no student ${PLANTED_REQUEST.body}`));
      });
    });
    await settleSdk();
    assertNothingLeaked();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    const [event] = outbox.events();
    assert.equal(event?.exception?.values?.[0]?.value, "[message withheld]");
    assert.equal(event?.exception?.values?.[0]?.mechanism?.type, "internal");
    assert.equal(event?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
    assert.equal(event?.server_name, undefined);
    assert.equal(event?.request, undefined);
  });

  // The SDK reads the null before `beforeSend` is reached: `applyDebugMeta`
  // (@sentry/core utils/prepareEvent.js) throws "Cannot read properties of
  // null (reading 'stacktrace')", and the SDK reports THAT. A scrub that
  // cannot throw does not help here; only the wire filter sees this event.
  it("an event processor that plants a null in exception.values leaves a scrubbed report, with no trace header", async () => {
    await insideRequest(async () => {
      Sentry.withScope((scope) => {
        scope.addEventProcessor((event) => ({ ...event, exception: { values: nullFirst(event.exception?.values ?? []) } }));
        Sentry.captureException(new Error(`no student ${PLANTED_REQUEST.body}`));
      });
    });
    await settleSdk();
    assertNothingLeaked();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    const [event] = outbox.events();
    assert.deepEqual(
      event?.exception?.values?.map((entry) => [entry.type, entry.value, entry.mechanism?.type]),
      [["TypeError", "[message withheld]", "internal"]],
    );
    assert.equal(event?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
    assert.equal(event?.server_name, undefined);
  });

  it("an event captured with the SDK's own skip-beforeSend hint is scrubbed all the same", async () => {
    await insideRequest(async () => {
      Sentry.captureException(new Error(`no student ${PLANTED_REQUEST.body}`), { data: { __sentry__: true } });
    });
    await settleSdk();
    assertNothingLeaked();
    assert.deepEqual(outbox.itemTypes(), ["event"]);
    assert.equal(outbox.events()[0]?.exception?.values?.[0]?.value, "[message withheld]");
    assert.equal(outbox.events()[0]?.transaction, `POST ${PLANTED_REQUEST.routePattern}`);
  });
});

/** The list with a null in front, which the SDK's types say cannot happen. */
function nullFirst<T>(list: readonly T[]): T[] {
  return JSON.parse("[null]").concat(list);
}
