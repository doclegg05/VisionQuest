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
 *
 * 2026-09-06: a secret is not always a query parameter. Connect's employer
 * links carry the capability as a path SEGMENT (`/connect/<token>` and
 * `/api/connect/employer/<token>/…`), which the `key=value` rule never saw —
 * see CAPABILITY_PATH_SEGMENT below. Header values are text-scrubbed now too,
 * because `referer` carried whatever the URL carried.
 */

type RequestData = NonNullable<Event["request"]>;
type QueryParams = NonNullable<RequestData["query_string"]>;
type SentryUser = NonNullable<Event["user"]>;
type EventSpan = NonNullable<Event["spans"]>[number];
type EventException = NonNullable<Event["exception"]>;
type EventTags = NonNullable<Event["tags"]>;

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

/**
 * Capability tokens that are a PATH SEGMENT rather than a query parameter
 * (2026-09-06).
 *
 * `SECRET_PARAM` above matches `key=value`, which is the shape the
 * password-reset token travels in. PR #204 added employer response links
 * where the token IS a path segment — `/connect/<token>` for the response
 * page and `/api/connect/employer/<token>/{interested,not-now,hired}` for its
 * actions — so nothing here matched them and the token arrived at Sentry
 * intact in `request.url`, in the referer header, and in navigation and fetch
 * breadcrumbs. That token is a 14-day bearer capability over one student's
 * packet and résumé: a copy of it is a copy of the access.
 *
 * The 20-character floor is what keeps route names readable. Real tokens are
 * 43 characters (32 random bytes, base64url); `/connect/report` and the three
 * action suffixes are far shorter, and blanking those would cost the one
 * thing the event is for — knowing which page broke — while protecting
 * nothing. The character class is base64url plus `-` and `_`, which is every
 * character a minted token can contain.
 *
 * IT ALSO CATCHES `/api/connect/<connectionId>/{approve,withdraw}`, whose id
 * is a cuid long enough to clear the floor. That is deliberate rather than
 * collateral: a `Connection.id` resolves to one student's employer
 * disclosure, and .claude/rules/security.md counts a student identifier as
 * PII in a log sink. Redacting it is the call the rest of the codebase
 * already makes, and the route still names the failing endpoint.
 *
 * Deliberately NOT caught: `/api/teacher/connect/employers/<id>/contacts` and
 * `/api/teacher/connect/connections/<id>`, where the segment directly after
 * `/connect/` is a literal (`employers`, `connections`) and the id sits a
 * level deeper. Those are staff-authenticated routes carrying no capability.
 *
 * Extend-only: this is a second `.replace` in `redactText`, and no existing
 * rule is touched.
 *
 * W1 (2026-09-06): case-insensitive, and `/+` at every separator. A URL is
 * not case-normalized on its way into an event, and a doubled slash survives
 * every layer between the browser and Sentry — `/CONNECT/<token>` and
 * `/connect//<token>` both reach the same route and both slipped the
 * original pattern. Widening here only ever redacts more.
 */
const CAPABILITY_PATH_SEGMENT = /(\/+(?:api\/+connect\/+employer|connect)\/+)[A-Za-z0-9_-]{20,}/gi;

const REDACTED = "[REDACTED]";
/** On an auth route the body is a credential by definition; drop it whole. */
const AUTH_ROUTE = /\/api\/auth(?:[/?#]|$)/;
const DROPPED_HEADERS = new Set(["cookie", "authorization", "x-forwarded-for"]);
/** Sentry normalizes to depth 3 before beforeSend; this is only a cycle guard. */
const MAX_DATA_DEPTH = 8;

function redactText(text: string): string {
  return text
    .replace(SECRET_PARAM, `$1$2=${REDACTED}`)
    .replace(CAPABILITY_PATH_SEGMENT, `$1${REDACTED}`)
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

/**
 * Headers were previously filtered but never text-scrubbed, so anything the
 * URL rules would have stripped survived in `referer` — which on the employer
 * response page is a byte-for-byte copy of the capability URL. Surviving
 * headers now go through `redactText` as well, which is strictly more
 * redaction: the drop list is unchanged and applies first.
 */
function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase()))
      .map(([name, value]) => [name, typeof value === "string" ? redactText(value) : value]),
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
 * A traced request carries its URL in the span tree, not in `request.url`:
 * `description` is the route and `data["http.url"]` the absolute URL.
 */
function scrubSpan(span: EventSpan): EventSpan {
  const { data, description } = span;
  return {
    ...span,
    ...(description !== undefined && { description: redactText(description) }),
    ...(data !== undefined && { data: scrubRecord(data, 0) as EventSpan["data"] }),
  };
}

/** The URL usually lands in `exception.values[].value` as the error message. */
function scrubException(exception: EventException): EventException {
  const { values } = exception;
  if (values === undefined) return exception;
  return {
    ...exception,
    values: values.map((entry) => ({
      ...entry,
      ...(entry.value !== undefined && { value: redactText(entry.value) }),
    })),
  };
}

/** Tag values are primitives, so only the strings among them are text. */
function scrubTags(tags: EventTags): EventTags {
  return Object.fromEntries(
    Object.entries(tags).map(([key, value]) => {
      if (SECRET_KEY.test(key)) return [key, REDACTED];
      return [key, typeof value === "string" ? redactText(value) : value];
    }),
  );
}

/**
 * Generic over the event kind so one function serves `beforeSend`
 * (ErrorEvent) and `beforeSendTransaction` (TransactionEvent); the SDK
 * package does not re-export the transaction type, so overloads are not an
 * option here.
 *
 * W1 (2026-09-06): the patch used to cover `user`, `request` and
 * `breadcrumbs` only, which is most of an ERROR event and almost none of a
 * TRANSACTION — and this same function is `beforeSendTransaction` in all
 * three configs. A transaction names its route in `transaction`, repeats it
 * in every `spans[].description` and `spans[].data["http.url"]`, and again in
 * `contexts.trace.data["http.url"]`; an error repeats it in `message`,
 * `exception.values[].value`, `extra`, and `tags`. A capability token in the
 * path therefore reached Sentry through six fields the scrub never touched.
 * Every field below goes through the same `redactText`/`scrubData` the
 * request already used, which are idempotent, so this only ever removes more.
 *
 * `scrubData` on `contexts` also blanks a context literally named `state`,
 * `code`, or `key` (SECRET_KEY). That is the safe direction and it costs
 * nothing an operator needs: `contexts.trace` and `contexts.runtime`, the two
 * that carry the debugging value, are untouched.
 */
export function scrubPii<E extends Event>(event: E, _hint?: EventHint): E {
  const patch: Pick<
    Event,
    "user" | "request" | "breadcrumbs" | "transaction" | "message" | "extra" | "tags" | "contexts" | "spans" | "exception"
  > = {
    ...(event.user !== undefined && { user: scrubUser(event.user) }),
    ...(event.request !== undefined && { request: scrubRequest(event.request) }),
    ...(event.breadcrumbs !== undefined && { breadcrumbs: event.breadcrumbs.map(scrubBreadcrumb) }),
    ...(event.transaction !== undefined && { transaction: redactText(event.transaction) }),
    ...(event.message !== undefined && { message: redactText(event.message) }),
    ...(event.extra !== undefined && { extra: scrubRecord(event.extra, 0) as Event["extra"] }),
    ...(event.tags !== undefined && { tags: scrubTags(event.tags) }),
    ...(event.contexts !== undefined && { contexts: scrubData(event.contexts) as Event["contexts"] }),
    ...(event.spans !== undefined && { spans: event.spans.map(scrubSpan) }),
    ...(event.exception !== undefined && { exception: scrubException(event.exception) }),
  };
  return { ...event, ...patch };
}
