import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { scrubPii } from "./sentry-scrub";
import { browserErrorEvent, chainedExceptionEvent, PLANTED, plantedIn, serverSelfCapturedEvent, thrownObjectEvent } from "./sentry.test-support";

// H1 third pass (2026-11-10). `scrubPii` threw on an event with a `null`
// inside `exception.values`. The SDK reports a throw from `beforeSend` as a
// NEW event that skips `beforeSend`
// (node_modules/@sentry/core/build/cjs/client.js, `_processEvent`: the
// `isInternalException(hint)` branch returns the prepared event as it is), so
// a scrub that can throw is a scrub that can be skipped. It is total now: any
// input at all returns an event built from the allowlist, or null.
//
// Each row is a shape the SDK's own types say cannot happen. An event
// processor, an integration or a later SDK version can still produce one.

/** `scrubPii` is typed for an Event, and these rows are deliberately not one: hence the cast. */
const scrubAnything = scrubPii as (event: unknown) => ReturnType<typeof scrubPii>;

const HOSTILE = `${PLANTED.name} ${PLANTED.recordId}`;

function throwing(): never {
  throw new Error(`getter ${HOSTILE}`);
}

/** `base` with a `key` that throws when it is read. Not a spread, which would read it here. */
function throwsOnRead(key: string, base: object = {}): object {
  return Object.defineProperty(base, key, { get: throwing, enumerable: true, configurable: true });
}

/** Throws on every operation a caller could try. */
function hostileProxy(): object {
  return new Proxy(
    {},
    { get: throwing, has: throwing, ownKeys: throwing, getOwnPropertyDescriptor: throwing, getPrototypeOf: throwing },
  );
}

function nested(depth: number): object {
  let value: object = { leaf: HOSTILE };
  for (let i = 0; i < depth; i += 1) value = { inner: value, values: [value], frames: [value] };
  return value;
}

function circular(): Record<string, unknown> {
  const event: Record<string, unknown> = { ...browserErrorEvent() };
  const entry: Record<string, unknown> = { type: "Error", value: HOSTILE };
  entry.cause = entry;
  entry.stacktrace = { frames: [entry] };
  event.exception = { values: [entry, event] };
  event.tags = event;
  event.extra = event;
  event.contexts = event;
  event.sdk = event;
  event.self = event;
  return event;
}

/** A valid event with one field replaced. */
function eventWith(field: string, value: unknown): Record<string, unknown> {
  return { ...serverSelfCapturedEvent(), [field]: value };
}

const frame = { filename: "/srv/app/a.js", function: "run", lineno: 1, colno: 2, in_app: true };
/** A valid event whose one exception has `patch` laid over it, getters kept as getters. */
function entryWith(patch: object): Record<string, unknown> {
  const entry = Object.defineProperties({ type: "Error", value: HOSTILE }, Object.getOwnPropertyDescriptors(patch));
  return eventWith("exception", { values: [entry] });
}

const WRONG_TYPES: readonly unknown[] = [null, undefined, HOSTILE, 7, BigInt(10), true, Symbol("s"), [HOSTILE], () => HOSTILE, new Date(0), new Uint8Array(4), Number.NaN];

const ROWS: readonly [name: string, input: unknown][] = [
  ...WRONG_TYPES.map((value): [string, unknown] => [`the event itself is ${describeValue(value)}`, value]),
  ["the event is a Proxy that throws on any access", hostileProxy()],
  ["the event is circular at every field the scrub reads", circular()],
  ["the event is nested ten thousand levels deep", { ...browserErrorEvent(), ...nested(10_000), extra: nested(10_000), contexts: nested(10_000) }],
  ["a megabyte of text where an id belongs", { ...browserErrorEvent(), event_id: "a".repeat(1_000_000), transaction: `/${"a".repeat(1_000_000)}` }],

  // The four the audit named: a null entry in each list the scrub maps over.
  ["a null entry in exception.values", eventWith("exception", { values: [null, { type: "Error", value: HOSTILE }] })],
  ["a null entry in a stack's frames", entryWith({ stacktrace: { frames: [null, frame] } })],
  ["a null entry in sdk.packages", eventWith("sdk", { name: "sentry.javascript.nextjs", version: "10.76.2", packages: [null] })],
  ["a null entry in debug_meta.images", eventWith("debug_meta", { images: [null] })],

  ["exception.values holds text, numbers and undefined", eventWith("exception", { values: [HOSTILE, 7, undefined] })],
  ["exception.values is text", eventWith("exception", { values: HOSTILE })],
  ["a stacktrace is null", entryWith({ stacktrace: null })],
  ["a stacktrace's frames are text", entryWith({ stacktrace: { frames: HOSTILE } })],
  ["a frame is text", entryWith({ stacktrace: { frames: [HOSTILE] } })],
  ["a mechanism is text", entryWith({ mechanism: HOSTILE })],
  ["sdk.integrations holds null and numbers", eventWith("sdk", { integrations: [null, 4, HOSTILE] })],
  ["sdk.packages is text", eventWith("sdk", { packages: HOSTILE })],
  ["a debug image is text", eventWith("debug_meta", { images: [HOSTILE] })],
  ["contexts.trace and contexts.runtime are text", eventWith("contexts", { trace: HOSTILE, runtime: HOSTILE })],
  ["a message and a transaction that throw when read as text", { ...browserErrorEvent(), message: { toString: throwing }, transaction: { toString: throwing } }],
  ["a tag value that throws when serialized", eventWith("tags", { route: { toJSON: throwing, toString: throwing }, alert: { [Symbol.toPrimitive]: throwing } })],

  ...["type", "event_id", "timestamp", "level", "platform", "message", "transaction", "tags", "extra", "request", "exception", "contexts", "sdk", "debug_meta"].flatMap(
    (field): [string, unknown][] => [
      ...WRONG_TYPES.map((value): [string, unknown] => [`${field} is ${describeValue(value)}`, eventWith(field, value)]),
      [`${field} is a getter that throws`, throwsOnRead(field, { ...serverSelfCapturedEvent() })],
      [`${field} is a Proxy that throws on any access`, eventWith(field, hostileProxy())],
    ],
  ),

  ["exception.values is a getter that throws", eventWith("exception", throwsOnRead("values"))],
  ["an exception entry is a Proxy that throws", eventWith("exception", { values: [hostileProxy()] })],
  ["an exception's stacktrace is a getter that throws", entryWith(throwsOnRead("stacktrace"))],
  ["a frame's filename is a getter that throws", entryWith({ stacktrace: { frames: [throwsOnRead("filename")] } })],
  ["a frame is a Proxy that throws", entryWith({ stacktrace: { frames: [hostileProxy()] } })],
  ["a mechanism's type is a getter that throws", entryWith({ mechanism: throwsOnRead("type") })],
  ["an sdk package's name is a getter that throws", eventWith("sdk", { packages: [throwsOnRead("name")] })],
  ["a debug image's code_file is a getter that throws", eventWith("debug_meta", { images: [throwsOnRead("code_file")] })],
  ["contexts.trace is a Proxy that throws", eventWith("contexts", { trace: hostileProxy() })],
  ["request.url is a getter that throws", eventWith("request", throwsOnRead("url"))],
];

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "an array";
  if (value instanceof Date) return "a Date";
  if (value instanceof Uint8Array) return "bytes";
  return typeof value === "number" && Number.isNaN(value) ? "NaN" : `a ${typeof value}`;
}

const consoleError = mock.method(console, "error", () => {});

describe("scrubPii is total: no input makes it throw", () => {
  for (const [name, input] of ROWS) {
    it(name, () => {
      let out: unknown;
      assert.doesNotThrow(() => {
        out = scrubAnything(input);
      });
      // What it returns can be put on the wire as it is: plain data, with
      // nothing of the hostile input left in it.
      let wire = "";
      assert.doesNotThrow(() => {
        wire = JSON.stringify(out) ?? "";
      });
      assert.deepEqual(plantedIn(wire), []);
    });
  }

  it("covers every level the scrub reads", () => {
    assert.ok(ROWS.length > 200, `only ${ROWS.length} rows`);
  });
});

describe("scrubPii drops what it cannot read", () => {
  it("returns null for a value that is not an event object", () => {
    for (const value of WRONG_TYPES) assert.equal(scrubAnything(value), null, describeValue(value));
  });

  it("returns null, and not a half-built event, when reading the event throws", () => {
    assert.equal(scrubAnything(hostileProxy()), null);
    assert.equal(scrubAnything(eventWith("exception", { values: [null] })), null);
    assert.equal(scrubAnything(entryWith({ stacktrace: { frames: [null] } })), null);
    assert.equal(scrubAnything(eventWith("sdk", { packages: [null] })), null);
    assert.equal(scrubAnything(eventWith("debug_meta", { images: [null] })), null);
  });

  it("leaves one fixed line in the log, with nothing from the event in it", () => {
    consoleError.mock.resetCalls();
    scrubAnything(entryWith(throwsOnRead("stacktrace")));
    assert.deepEqual(
      consoleError.mock.calls.map((call) => call.arguments),
      [['{"level":"error","message":"sentry_scrub_dropped_event"}']],
    );
  });

  it("prints nothing for an event it scrubs, or for a transaction it refuses", () => {
    consoleError.mock.resetCalls();
    scrubPii(serverSelfCapturedEvent());
    scrubPii({ type: "transaction" });
    assert.equal(consoleError.mock.callCount(), 0);
  });
});

// The wire filter scrubs every event a second time (src/lib/sentry-wire.ts),
// so a second pass must not take anything more from a well-formed event.
describe("scrubbing an event twice", () => {
  for (const [name, build] of [
    ["a browser error", browserErrorEvent],
    ["a chained error with an inline-script frame", chainedExceptionEvent],
    ["a thrown object", thrownObjectEvent],
    ["a server error inside a request", serverSelfCapturedEvent],
  ] as const) {
    it(`changes nothing the first pass kept: ${name}`, () => {
      const once = scrubPii(build());
      assert.ok(once);
      assert.deepEqual(scrubPii(once), once);
    });
  }
});
