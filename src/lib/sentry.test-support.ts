/**
 * Test support for error reporting (H1, 2026-11-10), in two parts.
 *
 * 1. Planted student data, and events written in the shapes the installed
 *    SDK (@sentry/nextjs 10.76.2) builds, for tests of the scrub alone.
 * 2. The real server SDK, started with the app's own options
 *    (sentry.server.config.ts) and a transport that records instead of
 *    sending. The first H1 tests ran against a hand-made stand-in for the
 *    SDK, which could only prove what its author thought the SDK attaches.
 *    These run the SDK itself: its request capture, its event pipeline, the
 *    app's `beforeSend`, and the envelope exactly as it would go on the wire.
 */
import http from "node:http";
import { addItemToEnvelope, createAttachmentEnvelopeItem, createEventEnvelope, makeDsn, parseEnvelope, serializeEnvelope } from "@sentry/core";
import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";
import { serverSentryOptions } from "../../sentry.server.config";

// ---------------------------------------------------------------------------
// Planted student data and SDK-shaped events (H1 privacy follow-up,
// 2026-11-10). Every fixture below is written in the shape the installed SDK
// (@sentry/nextjs 10.76.2) builds, with the file that builds it cited, and
// every one carries planted strings. A test passes only when none of them is
// left anywhere in what would be sent.
// ---------------------------------------------------------------------------

/** One student's data, in each form the app handles it. None may reach Sentry. */
export const PLANTED = {
  name: "Tanesha Rivers",
  email: "tanesha.rivers@example.org",
  loginId: "trivers",
  recordId: "cm3x9k2qp0000ab12cd34ef56",
  chat: "I want to hurt myself",
  search: "felony record jobs",
  slug: "tanesha-rivers",
  password: "hunter2-Sunset",
} as const;

/**
 * What to look for in a serialized event. Lower case, because the comparison
 * is: a URL-encoded or upper-cased copy of an identifier is still a leak.
 */
const NEEDLES: readonly string[] = [
  "tanesha",
  PLANTED.loginId,
  PLANTED.recordId,
  "hurt myself",
  "hurt+myself",
  "hurt%20myself",
  "felony",
  PLANTED.password.toLowerCase(),
];

/** The planted strings still present in `value`, as it would be serialized. */
export function plantedIn(value: unknown): string[] {
  const text = (JSON.stringify(value) ?? "").toLowerCase();
  return NEEDLES.filter((needle) => text.includes(needle));
}

const PAGE_URL = `https://vq.example/credentials/${PLANTED.slug}?q=${encodeURIComponent(PLANTED.search)}`;
const STUDENT_PAGE = `https://vq.example/teacher/students/${PLANTED.recordId}`;

/**
 * The breadcrumb trail of a browser page.
 * - click: browser/build/npm/cjs/prod/integrations/breadcrumbs.js
 *   `_getDomBreadcrumbHandler`; the selector text comes from
 *   browser-utils/build/cjs/htmlTreeAsString.js, which writes the element's
 *   `aria-label`, `type`, `name`, `title` and `alt`.
 * - console, fetch, navigation: the same file's `_getConsoleBreadcrumbHandler`,
 *   `_getFetchBreadcrumbHandler` and `_getHistoryBreadcrumbHandler`.
 */
export const sdkBreadcrumbs = {
  click: (): Breadcrumb => ({
    timestamp: 1794341288.1,
    category: "ui.click",
    message: `li > button[aria-label="Mark \\"Possible crisis\\" resolved for ${PLANTED.name}"][title="${PLANTED.name}"]`,
  }),
  navigation: (): Breadcrumb => ({
    timestamp: 1794341288.2,
    category: "navigation",
    data: { from: `/teacher/students/${PLANTED.recordId}`, to: `/credentials/${PLANTED.slug}` },
  }),
  fetch: (): Breadcrumb => ({
    timestamp: 1794341288.3,
    category: "fetch",
    type: "http",
    data: { method: "GET", url: `/api/jobs?q=${PLANTED.search.replace(/ /g, "+")}`, status_code: 200 },
  }),
  console: (): Breadcrumb => ({
    timestamp: 1794341288.4,
    category: "console",
    level: "error",
    message: "save failed [object Object]",
    data: { arguments: ["save failed", { displayName: PLANTED.name, message: PLANTED.chat }], logger: "console" },
  }),
};

/** One exception with a parsed stack frame; `filename` is where the script came from. */
function exceptionAt(filename: string, fn: string): NonNullable<NonNullable<Event["exception"]>["values"]>[number] {
  return {
    type: "Error",
    value: "placeholder",
    stacktrace: { frames: [{ filename, function: fn, lineno: 12, colno: 7, in_app: true }] },
  };
}

/**
 * A browser error event before `beforeSend`. `request` is what HttpContext
 * attaches (browser/.../integrations/httpcontext.js with helpers.js
 * `getHttpRequestData`): the page URL, the referrer and the user agent.
 */
export function browserErrorEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: "cf422e038c924d96b957b892a76f01c8",
    timestamp: 1794341288.62,
    level: "error",
    platform: "javascript",
    environment: "production",
    request: { url: PAGE_URL, headers: { Referer: STUDENT_PAGE, "User-Agent": "Mozilla/5.0 (Linux; Android 10)" } },
    exception: {
      values: [
        { ...exceptionAt("https://vq.example/_next/static/chunks/app/layout-0a1b2c3d.js", "onClick"), value: "boom" },
      ],
    },
    contexts: {
      trace: { trace_id: "56341d57f6794f93b8a549a6e413fed2", span_id: "a6f2a9809943c2b8" },
      culture: { locale: "en-US", timezone: "America/New_York" },
    },
  };
}

/**
 * A chained error: LinkedErrors puts the cause first and the outer error last
 * (core/build/cjs/utils/aggregate-errors.js), each with its own message. The
 * JSON one quotes its input, as `JSON.parse` does.
 */
export function chainedExceptionEvent(): ErrorEvent {
  return {
    ...browserErrorEvent(),
    exception: {
      values: [
        {
          ...exceptionAt("https://vq.example/_next/static/chunks/app/layout-0a1b2c3d.js", "parseReply"),
          type: "SyntaxError",
          value: `Unexpected token 'I', "${PLANTED.chat}" is not valid JSON`,
          mechanism: { type: "chained", handled: true, source: "cause", exception_id: 1, parent_id: 0 },
        },
        {
          ...exceptionAt(PAGE_URL, "HTMLButtonElement.<anonymous>"),
          type: "Error",
          value: `could not save ${PLANTED.name} (${PLANTED.loginId})`,
          mechanism: { type: "generic", handled: true, exception_id: 0 },
        },
      ],
    },
  };
}

/**
 * A thrown plain object: the SDK keeps the whole object as
 * `extra.__serialized__` (browser/.../eventbuilder.js `eventFromPlainObject`;
 * core/build/cjs/utils/eventbuilder.js on the server) and lists its keys in
 * the message.
 */
export function thrownObjectEvent(): ErrorEvent {
  return {
    ...browserErrorEvent(),
    exception: {
      values: [
        {
          type: "Error",
          value: "Object captured as exception with keys: displayName, password",
          mechanism: { type: "generic", handled: true, synthetic: true },
        },
      ],
    },
    extra: { __serialized__: { displayName: PLANTED.name, password: PLANTED.password } },
  };
}

/**
 * A server event raised inside a request, as the SDK captures it by itself
 * (an unhandled rejection, node-core/.../integrations/onunhandledrejection.js).
 * RequestData (core/build/cjs/integrations/requestdata.js) attaches the URL,
 * query string, headers, cookies and the request body, which the HTTP
 * integration read because `maxIncomingRequestBodySize` defaults to "medium"
 * (core/build/cjs/integrations/http/server-subscription.js).
 */
export function serverSelfCapturedEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: "5a5f9020952246c684cc5e9358089b1e",
    timestamp: 1794341325.141,
    level: "error",
    platform: "node",
    environment: "production",
    server_name: "srv-vq-web-7c9d",
    request: {
      url: `https://vq.example/api/teacher/students/${PLANTED.loginId}/notes?q=${encodeURIComponent(PLANTED.search)}`,
      method: "POST",
      query_string: `q=${encodeURIComponent(PLANTED.search)}`,
      headers: { cookie: "vq-session=eyJhbGciOi", referer: STUDENT_PAGE, "user-agent": "Mozilla/5.0" },
      cookies: { "vq-session": "eyJhbGciOi" },
      data: JSON.stringify({ message: `my name is ${PLANTED.name} and ${PLANTED.chat}` }),
    },
    user: { ip_address: "10.0.0.9" },
    breadcrumbs: [
      { timestamp: 1794341325.1, category: "console", level: "log", message: `looked up ${PLANTED.email}` },
      { timestamp: 1794341325.12, category: "http", data: { url: `https://storage.example/uploads/${PLANTED.slug}-resume.pdf` } },
    ],
    exception: {
      values: [
        {
          ...exceptionAt("/opt/render/project/src/.next/server/chunks/ssr/src_lib_notes_ts.js", "saveNote"),
          type: "PrismaClientValidationError",
          value: `Invalid invocation: where: { displayName: "${PLANTED.name}", id: "${PLANTED.recordId}" }`,
          mechanism: { type: "auto.node.onunhandledrejection", handled: false },
        },
      ],
    },
    extra: { unhandledPromiseRejection: true, lastRecipient: PLANTED.email },
    contexts: {
      trace: { trace_id: "ab9477294c1144fba2f9b0df674298c2", span_id: "b262c1c2f243b9d4" },
      runtime: { name: "node", version: "v24.22.1" },
      device: { arch: "arm64", processor_count: 10 },
    },
    modules: { next: "16.4.3" },
  };
}

/**
 * A traced request. The transaction names the real path and carries the same
 * request data, and each span repeats the URL
 * (core/build/cjs/integrations/requestdata.js `addNormalizedRequestDataToSpan`).
 */
export function transactionEvent(): Event {
  return {
    type: "transaction",
    event_id: "9c1d2e3f4a5b4c6d8e7f1a2b3c4d5e6f",
    transaction: `POST /api/teacher/students/${PLANTED.loginId}/notes`,
    request: {
      url: "https://vq.example/api/chat/send",
      method: "POST",
      data: JSON.stringify({ message: `my name is ${PLANTED.name} and ${PLANTED.chat}` }),
    },
    spans: [
      {
        span_id: "3".repeat(16),
        trace_id: "1".repeat(32),
        start_timestamp: 0,
        description: `GET /api/jobs?q=${PLANTED.search}`,
        data: { "http.request.body.data": PLANTED.chat },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The real server SDK with a recording transport.
// ---------------------------------------------------------------------------

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type Transport = ReturnType<NonNullable<InitOptions["transport"]>>;
export type Envelope = Parameters<Transport["send"]>[0];

/** A well-formed DSN on a current ingest host. Nothing is ever sent to it. */
export const TEST_DSN = "https://public@o123.ingest.us.sentry.io/456";

// ---------------------------------------------------------------------------
// Envelopes as they are on the wire (H1 third pass, 2026-11-10).
// ---------------------------------------------------------------------------

/**
 * The bytes the SDK would send for these envelopes, as text, from the SDK's
 * own serializer (@sentry/core utils/envelope.js `serializeEnvelope`). Search
 * this, not `JSON.stringify(envelope)`: an attachment's payload is bytes, and
 * JSON writes bytes as a list of numbers that no search for a name can match.
 */
export function wireText(envelopes: readonly Envelope[]): string {
  return envelopes
    .map((envelope) => {
      const body = serializeEnvelope(envelope);
      return typeof body === "string" ? body : new TextDecoder().decode(body);
    })
    .join("\n");
}

/** One envelope item as it is written on the wire: its header line, then its payload line. */
function wireItem(header: object, payload: unknown): string {
  return `\n${JSON.stringify(header)}\n${JSON.stringify(payload)}`;
}

/** A header and one item of each given type, read back by the SDK's own parser. */
export function envelopeOf(types: readonly string[], header: object = { sent_at: "2026-11-10T21:00:00.000Z" }): Envelope {
  const items = types.map((type) => wireItem({ type }, { note: `${PLANTED.name} ${PLANTED.recordId}` }));
  return parseEnvelope(`${JSON.stringify(header)}${items.join("")}`);
}

const TRANSACTION_NAME = `POST /api/teacher/students/${PLANTED.recordId}/notes`;

/**
 * What must never be sent as it is: an event nobody scrubbed (the SDK skips
 * `beforeSend` for a report about its own failure), under a header that names
 * the real path and the DSN, next to one item of each kind that is not an
 * event. The event and its attachment are built by the SDK's helpers
 * (`createEventEnvelope`, `createAttachmentEnvelopeItem`). The SDK's types
 * allow no envelope to hold a session, a client report or a log beside an
 * event, so those three are appended as wire text and the whole is read back
 * with the SDK's parser: a transport takes whatever it is handed.
 */
export function hostileEnvelope(): Envelope {
  const event: Event = {
    ...serverSelfCapturedEvent(),
    transaction: TRANSACTION_NAME,
    sdkProcessingMetadata: {
      dynamicSamplingContext: { trace_id: "ab9477294c1144fba2f9b0df674298c2", public_key: "public", transaction: TRANSACTION_NAME },
    },
  };
  const metadata = { sdk: { name: "sentry.javascript.nextjs", version: "10.76.2", settings: { infer_ip: "auto" as const } } };
  const withEvent = createEventEnvelope(event, makeDsn(TEST_DSN), metadata, "https://vq.example/monitoring");
  const withAttachment = addItemToEnvelope(
    withEvent,
    createAttachmentEnvelopeItem({ filename: `${PLANTED.slug}-resume.pdf`, data: `resume of ${PLANTED.name}` }),
  );
  const session = wireItem({ type: "session" }, { sid: "0f8b3c0e9d2a4f6b8c1d2e3f4a5b6c7d", did: PLANTED.loginId, status: "ok" });
  const report = wireItem({ type: "client_report" }, { timestamp: 1794341325, discarded_events: [{ reason: "before_send", category: "error", quantity: 1 }] });
  const log = wireItem(
    { type: "log", item_count: 1, content_type: "application/vnd.sentry.items.log+json" },
    { items: [{ timestamp: 1794341325.1, level: "info", body: `looked up ${PLANTED.email}`, trace_id: "ab9477294c1144fba2f9b0df674298c2" }] },
  );
  return parseEnvelope(`${wireText([withAttachment])}${session}${report}${log}`);
}

/** A transport that records what it is handed and sends nothing. */
export interface RecordingTransport {
  envelopes: Envelope[];
  /** For the SDK's `transport` option, or for the app's options to wrap. */
  make: () => Transport;
  itemTypes(): string[];
  events(): Event[];
}

export function recordingTransport(): RecordingTransport {
  const envelopes: Envelope[] = [];
  const transport: Transport = {
    send: async (envelope: Envelope) => {
      envelopes.push(envelope);
      return {};
    },
    flush: async () => true,
  };
  return {
    envelopes,
    make: () => transport,
    itemTypes: () => envelopes.flatMap(envelopeItems).map(([type]) => type),
    events: () => eventsIn(envelopes),
  };
}

/** Everything the SDK handed to its transport: all that would leave the process. */
export interface Outbox {
  envelopes: Envelope[];
  /** The type of every envelope item: "event", "transaction", "session", "client_report". */
  itemTypes(): string[];
  /** The error events among the items. */
  events(): Event[];
  clear(): void;
}

function isEvent(payload: unknown): payload is Event {
  return typeof payload === "object" && payload !== null && !(payload instanceof Uint8Array);
}

/** Each item of an envelope as its type and its payload. */
export function envelopeItems(envelope: Envelope): [type: string, payload: unknown][] {
  const items: [string, unknown][] = [];
  for (const [header, payload] of envelope[1]) items.push([header.type, payload]);
  return items;
}

/** The error events in a list of envelopes. */
export function eventsIn(envelopes: readonly Envelope[]): Event[] {
  return envelopes
    .flatMap(envelopeItems)
    .filter(([type]) => type === "event")
    .map(([, payload]) => payload)
    .filter(isEvent);
}

function createOutbox(): Outbox {
  const envelopes: Envelope[] = [];
  return {
    envelopes,
    itemTypes: () => envelopes.flatMap(envelopeItems).map(([type]) => type),
    events: () => eventsIn(envelopes),
    clear: () => {
      envelopes.length = 0;
    },
  };
}

/**
 * Starts the real server SDK with `serverSentryOptions`. Only the last step
 * differs from production: where the SDK's Node transport would make a
 * request, this records. The app's wire filter (src/lib/sentry-wire.ts) is
 * in front of it, as it is in front of the real one, so the outbox holds
 * exactly what would be posted. Call it once per test file: the SDK ignores
 * a second `init` in the same process.
 */
export function startServerSdk(): Outbox {
  const outbox = createOutbox();
  const record: Transport = {
    send: async (envelope: Envelope) => {
      outbox.envelopes.push(envelope);
      return {};
    },
    flush: async () => true,
  };
  Sentry.init(serverSentryOptions(TEST_DSN, () => record));
  return outbox;
}

/** Waits until the SDK has handed over everything it is going to send. */
export async function settleSdk(): Promise<void> {
  await Sentry.flush(2_000);
}

/**
 * The real SDK's exports, for `mock.module("@sentry/nextjs", ...)`. Not a
 * stand-in: every function is the SDK's own. A test needs it only when the
 * code under test loads the SDK with `import()`, because under the test
 * loader a dynamic import of this CommonJS package exposes a fraction of its
 * named exports (30 of 202), and `withScope` is not among them.
 */
export const realSdkExports: Record<string, unknown> = { ...Sentry };

/** The request `insideRequest` makes: planted data in the path, query, cookie, referer and body. */
export const PLANTED_REQUEST = {
  path: `/api/teacher/students/${PLANTED.recordId}/notes?q=${encodeURIComponent(PLANTED.search)}`,
  routePattern: "/api/teacher/students/[param]/notes",
  headers: {
    cookie: `vq-session=${PLANTED.password}`,
    referer: `https://vq.example/credentials/${PLANTED.slug}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ displayName: PLANTED.name, email: PLANTED.email, message: PLANTED.chat }),
} as const;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("no port"));
      else resolve(address.port);
    });
  });
}

/** Reads the body with `data` listeners, which is how the SDK's body capture hooks in. */
function readBody(incoming: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => resolve(Buffer.concat(chunks)));
    incoming.on("error", reject);
  });
}

/**
 * Runs `handle` inside a real incoming HTTP request on a loopback server, so
 * the SDK's own HTTP integration sees the URL, query string, cookie, headers
 * and body exactly as it does in production. The handler gets the same
 * request as a fetch `Request`, as a Next route handler would, and runs in
 * the request's own scope: the `then` is registered inside the server's
 * `request` event, which is where the SDK sets that scope.
 */
export async function insideRequest(handle: (request: Request) => Promise<unknown>): Promise<void> {
  const server = http.createServer((incoming, response) => {
    readBody(incoming)
      .then((body) => {
        const { method, url = "/" } = incoming;
        return handle(new Request(`https://vq.example${url}`, { method, headers: PLANTED_REQUEST.headers, body: new Uint8Array(body) }));
      })
      .then(
        () => response.end("ok"),
        () => response.writeHead(500).end("the handler under test threw"),
      );
  });
  const port = await listen(server);
  try {
    const reply = await fetch(`http://127.0.0.1:${port}${PLANTED_REQUEST.path}`, {
      method: "POST",
      headers: PLANTED_REQUEST.headers,
      body: PLANTED_REQUEST.body,
    });
    const text = await reply.text();
    if (reply.status !== 200) throw new Error(text);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
