import type { Event, init } from "@sentry/nextjs";
import { isEventId, isLabel, scrubPii } from "./sentry-scrub";

/**
 * The allowlist, at the wire (H1 third pass, 2026-11-10).
 *
 * `scrubPii` is `beforeSend`, and the SDK does not call `beforeSend` for
 * everything it sends. It skips it for the report about its own failure:
 * when an event processor, an integration or `beforeSend` throws, the SDK
 * captures that throw with `data: { __sentry__: true }` and `_processEvent`
 * returns the prepared event as it is (@sentry/core build/cjs/client.js). It
 * also never calls it for anything that is not an error event: a session, a
 * client report, a log, a metric, a check-in, an attachment.
 *
 * So every envelope is rebuilt here, at the one place all of them pass: the
 * transport's `send`. All three runtimes wrap their transport with
 * `wireAllowlistTransport` (sentry.server.config.ts, sentry.edge.config.ts,
 * src/instrumentation-client.ts). What comes out holds error events that
 * `scrubPii` built, under a header of three keys, and nothing else. An
 * envelope with no such event is not sent.
 *
 * The SDK hands a transport the envelope as an object, `[header, items]`
 * with each item `[itemHeader, payload]` (@sentry/core utils/envelope.js;
 * the transport serializes it afterwards, transports/base.js), so nothing
 * here parses bytes. The SDK's envelope helpers and types are exported by
 * `@sentry/core` only, which this app does not depend on directly; the types
 * are read off `init`, and the tuples are built as that file builds them.
 */

type InitOptions = NonNullable<Parameters<typeof init>[0]>;
/** What the SDK sends through, in any runtime. */
export type Transport = ReturnType<NonNullable<InitOptions["transport"]>>;
export type Envelope = Parameters<Transport["send"]>[0];

type EnvelopeItem = Envelope[1][number];
/** The items whose payload the SDK types as an event. */
type EventCarryingItem = Extract<EnvelopeItem, [unknown, Event]>;

/** What `new Date().toISOString()` writes, which is how the SDK stamps `sent_at`: digits and punctuation. */
const SENT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The SDK's own rule for which item is an event: the item header's `type`
 * (@sentry/core build/types/types/envelope.d.ts). A transaction, a profile
 * and a feedback message travel under their own types and fail this.
 */
function isEventItem(item: EnvelopeItem): item is EventCarryingItem {
  return item[0].type === "event";
}

/** The error events among the items, each rebuilt by the scrub under a header that is its type alone. */
function eventItems(items: readonly EnvelopeItem[]): [{ type: "event" }, Event][] {
  return items.flatMap((item): [{ type: "event" }, Event][] => {
    const event = isEventItem(item) ? scrubPii(item[1]) : null;
    return event === null ? [] : [[{ type: "event" }, event]];
  });
}

/** `sdk` as an envelope header carries it: a name and a version, both plain labels, or nothing. */
function sdkHeader(sdk: unknown): { sdk?: { name: string; version: string } } {
  const { name, version }: { name?: unknown; version?: unknown } = Object(sdk);
  return isLabel(name) && isLabel(version) ? { sdk: { name, version } } : {};
}

/**
 * The envelope that may be sent in place of `envelope`, or null when none
 * may. Kept: each `event` item, rebuilt by `scrubPii`; from the header,
 * `event_id`, `sent_at` and the SDK's name and version. Dropped: every other
 * item, whatever its type (so a type a later SDK adds is dropped too), and
 * every other header key, `trace` (the trace id, and a transaction name
 * taken from the real path) and `dsn` among them.
 *
 * A header without a well-formed `event_id` and `sent_at` did not come from
 * the SDK's event path, and its envelope is not sent. This does not catch
 * what it cannot read: a throw leaves `send` before the transport is called,
 * so nothing is sent then either (the SDK's `sendEnvelope` catches it).
 */
export function allowlistedEnvelope(envelope: Envelope): Envelope | null {
  const [headers, items] = envelope;
  const events = eventItems(items);
  const { event_id, sent_at, sdk }: Record<string, unknown> = { ...headers };
  if (events.length === 0 || !isEventId(event_id) || typeof sent_at !== "string" || !SENT_AT.test(sent_at)) return null;
  return [{ event_id, sent_at, ...sdkHeader(sdk) }, events];
}

/**
 * Wraps a transport factory, for the SDK's `transport` option: the transport
 * it builds is only ever handed an envelope `allowlistedEnvelope` returned.
 * The SDK's default transports are not wrapped by anything; pass this one in
 * every `init`.
 */
export function wireAllowlistTransport<O>(makeTransport: (options: O) => Transport): (options: O) => Transport {
  return (options) => {
    const transport = makeTransport(options);
    return {
      send: async (envelope) => {
        const allowed = allowlistedEnvelope(envelope);
        return allowed === null ? {} : transport.send(allowed);
      },
      flush: (timeout) => transport.flush(timeout),
    };
  };
}
