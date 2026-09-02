import type { Breadcrumb, Event, EventHint } from "@sentry/nextjs";

/**
 * Strip PII and secrets from Sentry events before transmission.
 * VisionQuest handles TANF/SNAP recipients: no student data, and no credential
 * or one-time secret, may reach Sentry.
 *
 * Wired as both `beforeSend` (errors) and `beforeSendTransaction` (traces) in
 * sentry.server.config.ts, sentry.edge.config.ts, and sentry.client.config.ts;
 * src/lib/sentry-scrub.test.ts checks that wiring.
 *
 * Review F14 / SEC-06 (2026-09-01): the password-reset token travels as
 * `/reset-password?token=...` (forgot-password/route.ts), so request.url,
 * query_string, and navigation breadcrumbs are scrubbed of secret-bearing
 * parameters, and a request body never leaves an auth route.
 */

type RequestData = NonNullable<Event["request"]>;
type QueryParams = NonNullable<RequestData["query_string"]>;
type SentryUser = NonNullable<Event["user"]>;

/** Parameter and body keys whose values are credentials or one-time secrets. */
const SECRET_KEY_NAMES =
  "(?:access_?|refresh_?|id_?)?token|code|state|(?:new_?|current_?)?password|secret|otp|api_?key|key";
const SECRET_KEY = new RegExp(`^(?:${SECRET_KEY_NAMES})$`, "i");
/**
 * `key=value` pairs in a URL, query string, or log line. The leading group
 * anchors on a delimiter so `mytoken=` and `monkey=` stay untouched.
 */
const SECRET_PARAM = new RegExp(`(^|[?&#;\\s])(${SECRET_KEY_NAMES})=[^&#\\s]*`, "gi");
/** `"token": "value"` pairs inside a raw JSON body string. */
const SECRET_JSON_FIELD = new RegExp(`("(?:${SECRET_KEY_NAMES})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*"`, "gi");
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const REDACTED = "[REDACTED]";
/** On an auth route the body is a credential by definition; drop it whole. */
const AUTH_ROUTE = /\/api\/auth(?:[/?#]|$)/;
const DROPPED_HEADERS = new Set(["cookie", "authorization", "x-forwarded-for"]);
/** Sentry normalizes to depth 3 before beforeSend; this is only a cycle guard. */
const MAX_DATA_DEPTH = 8;

function redactText(text: string): string {
  return text
    .replace(SECRET_PARAM, `$1$2=${REDACTED}`)
    .replace(SECRET_JSON_FIELD, `$1${REDACTED}"`)
    .replace(EMAIL, "[EMAIL_REDACTED]");
}

function scrubRecord(record: object, depth: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED : scrubData(item, depth + 1),
    ]),
  );
}

function scrubData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (depth >= MAX_DATA_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => scrubData(item, depth + 1));
  if (value !== null && typeof value === "object") return scrubRecord(value, depth);
  return value;
}

function scrubQuery(query: QueryParams): QueryParams {
  if (typeof query === "string") return redactText(query);
  if (Array.isArray(query)) {
    return query.map(([key, value]): [string, string] => [
      key,
      SECRET_KEY.test(key) ? REDACTED : redactText(value),
    ]);
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, SECRET_KEY.test(key) ? REDACTED : redactText(value)]),
  );
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase())),
  );
}

function scrubRequest(request: RequestData): RequestData {
  const { cookies: _cookies, data, headers, query_string, url, ...rest } = request;
  const onAuthRoute = typeof url === "string" && AUTH_ROUTE.test(url);
  return {
    ...rest,
    ...(url !== undefined && { url: redactText(url) }),
    ...(query_string !== undefined && { query_string: scrubQuery(query_string) }),
    ...(headers !== undefined && { headers: scrubHeaders(headers) }),
    ...(data !== undefined && !onAuthRoute && { data: scrubData(data) }),
  };
}

function scrubUser(user: SentryUser): SentryUser {
  const { email: _email, username: _username, ip_address: _ipAddress, ...rest } = user;
  return rest;
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const { data, message, ...rest } = breadcrumb;
  return {
    ...rest,
    ...(message !== undefined && { message: redactText(message) }),
    ...(data !== undefined && { data: scrubRecord(data, 0) }),
  };
}

/**
 * Generic over the event kind so one function serves `beforeSend`
 * (ErrorEvent) and `beforeSendTransaction` (TransactionEvent); the SDK
 * package does not re-export the transaction type, so overloads are not an
 * option here.
 */
export function scrubPii<E extends Event>(event: E, _hint?: EventHint): E {
  const patch: Pick<Event, "user" | "request" | "breadcrumbs"> = {
    ...(event.user !== undefined && { user: scrubUser(event.user) }),
    ...(event.request !== undefined && { request: scrubRequest(event.request) }),
    ...(event.breadcrumbs !== undefined && { breadcrumbs: event.breadcrumbs.map(scrubBreadcrumb) }),
  };
  return { ...event, ...patch };
}
