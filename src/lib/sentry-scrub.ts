import type { ErrorEvent, Event, EventHint } from "@sentry/nextjs";
import { redactContactInfo } from "@/lib/log-redaction";
import { ROUTE_SEGMENTS } from "@/lib/route-segments.generated";

/**
 * What an error report may carry to Sentry, and nothing else.
 *
 * VisionQuest holds records of adults who receive TANF or SNAP benefits, and
 * Sentry is a third party with no data agreement. No name, email, login id,
 * record id, chat message, form value, search text or password may leave in
 * an error report.
 *
 * `scrubPii` is `beforeSend` in all three runtimes (sentry.server.config.ts,
 * sentry.edge.config.ts, src/instrumentation-client.ts). It does not edit the
 * SDK's event; it BUILDS a new one from an allowlist. A field that is not
 * named here is not sent, so a field a later SDK version adds is not sent
 * either. Every string that survives is a fixed literal or matches a closed
 * shape (an id, a class name, a source file, a route pattern); no sentence
 * can pass one.
 *
 * History: F14/SEC-06 (2026-09-01) redacted reset tokens in URLs, 2026-09-06
 * added capability tokens in the path, W1 and W11 widened the fields and
 * added phones and `user.id`. Each was a rule for one more place free text
 * was found. The 2026-11-10 audit of H1 found six more with SDK-shaped events
 * (breadcrumbs, the page URL, request bodies, thrown objects, exception
 * messages, stack frames named after the page), which is why this is an
 * allowlist now. `redactText` keeps the old rules as a second line on the few
 * strings that do pass.
 */

type ExceptionEntry = NonNullable<NonNullable<Event["exception"]>["values"]>[number];
type Mechanism = NonNullable<ExceptionEntry["mechanism"]>;
type Frame = NonNullable<NonNullable<ExceptionEntry["stacktrace"]>["frames"]>[number];
type EventTags = NonNullable<Event["tags"]>;
type EventContexts = NonNullable<Event["contexts"]>;
type Level = NonNullable<Event["level"]>;
type DebugImage = NonNullable<NonNullable<Event["debug_meta"]>["images"]>[number];

const WITHHELD = "[message withheld]";

// --- The second line: patterns for anything that still looks like data ------

/** Parameter and body keys whose values are credentials or one-time secrets. */
const SECRET_KEY_NAMES =
  "(?:access_?|refresh_?|id_?)?token|code|state|(?:new_?|current_?)?password|secret|otp|api_?key|key";
const SECRET_PARAM = new RegExp(`(^|[?&#;\\s])(${SECRET_KEY_NAMES})=[^&#\\s]*`, "gi");
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Employer and invite capability tokens that are a path segment (2026-09-06). */
const CAPABILITY_PATH_SEGMENT = /(\/+(?:api\/+connect\/+employer|connect|invite)\/+)[A-Za-z0-9_-]{20,}/gi;
/**
 * A record id: a Prisma `cuid()` (`c` plus 23 or 24 characters), or any other
 * 24- or 25-character id that starts with a letter and holds a digit (cuid2).
 * The edges are "not a letter or digit", so an id next to `_`, `-`, `/` or `:`
 * is caught, in either case (item 8). A 32-character trace id is longer than
 * the pattern and has no edge inside it, so it survives.
 */
const RECORD_ID = /(^|[^A-Za-z0-9])(?:c[a-z0-9]{23,24}|(?=[a-z0-9]{0,24}\d)[a-z][a-z0-9]{23,24})(?![A-Za-z0-9])/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function redactText(text: string): string {
  return redactContactInfo(
    text
      .replace(SECRET_PARAM, "$1$2=[REDACTED]")
      .replace(CAPABILITY_PATH_SEGMENT, "$1[REDACTED]")
      .replace(EMAIL, "[EMAIL_REDACTED]")
      .replace(UUID, "[ID]")
      .replace(RECORD_ID, "$1[ID]"),
  );
}

// --- Route patterns ----------------------------------------------------------

/** Segments kept as written: real route directories, and this module's own placeholder. */
const LITERAL_SEGMENTS = new Set([...ROUTE_SEGMENTS, "[param]"]);
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * The route pattern for a URL or path (H1, 2026-11-10). The origin, the query
 * string and the fragment are dropped, and a segment is kept only when it is
 * the name of a directory under src/app (src/lib/route-segments.generated.ts,
 * kept current by route-segments.test.ts). Anything else is `[param]`: a
 * record id, a capability token, a login name used as a credential slug, an
 * uploaded file's name.
 */
export function routePattern(path: string): string {
  const pathname = path.replace(ORIGIN, "").split(/[?#]/, 1)[0] ?? "";
  return pathname
    .split("/")
    .map((segment) => (segment === "" || LITERAL_SEGMENTS.has(segment) ? segment : "[param]"))
    .join("/");
}

// --- Shapes a kept string must match -----------------------------------------

const SHAPE = {
  eventId: /^[0-9a-f]{32}$/i,
  spanId: /^[0-9a-f]{16}$/i,
  debugId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /** An environment, release, platform, runtime or package name or version. */
  label: /^[A-Za-z0-9_.@:+/-]{1,100}$/,
  /** An alarm name, as src/lib/logger.ts sends one. */
  alarm: /^[a-z][a-z0-9_]{2,63}$/,
  jobName: /^[a-z][a-z0-9_-]{1,63}$/,
  /** An HTTP status, or a pg_cron run status (src/app/api/internal/cron-health). */
  status: /^(?:\d{3}|starting|running|sending|connecting|succeeded|failed)$/,
  errorType: /^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$/,
  mechanism: /^[A-Za-z0-9_.]{1,64}$/,
  mechanismSource: /^[a-z]{1,16}(?:\[\d{1,3}\])?$/,
  extraKey: /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
  functionName: /^(?:(?:async|new|get|set) )*[A-Za-z0-9_$.<>?*{}#-]{1,120}(?: \[as [A-Za-z0-9_$.]{1,60}\])?$/,
  /** A source file: no spaces, and a script extension. A sentence is neither. */
  codeFile: /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/{0,3})?[\w@.+~()[\]/\\%-]{1,300}\.(?:m?js|cjs|jsx|tsx?)$/,
  nodeInternal: /^node:[\w/.-]{1,80}$/,
  /** What `withheldServerEvent` writes: the marker and a code from `errorForLog`. */
  withheldValue: /^\[message withheld\](?: code (?:P\d{4}|E[A-Z_]{2,40}|[0-9A-Z]{5}))?$/,
  transaction: /^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) )?(\/\S*)$/,
} as const;

const LEVELS: ReadonlySet<string> = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
const HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isLevel(value: unknown): value is Level {
  return typeof value === "string" && LEVELS.has(value);
}

function shaped(shape: RegExp): (value: unknown) => value is string {
  return (value: unknown): value is string => typeof value === "string" && shape.test(value);
}

/** The named keys of `source` whose values pass `keep`; every other key is left behind. */
function pick<K extends string, V>(source: object, keys: readonly K[], keep: (value: unknown) => value is V): Partial<Record<K, V>> {
  const record: Record<string, unknown> = { ...source };
  const kept: Partial<Record<K, V>> = {};
  for (const key of keys) {
    const value = record[key];
    if (keep(value)) kept[key] = value;
  }
  return kept;
}

// --- Stack frames --------------------------------------------------------------

/**
 * Where a frame's code came from. A server frame names a file on disk. A
 * browser frame names a URL: a build asset under `/_next/` is kept as an
 * `app:///` path, and any other URL is a PAGE (an inline script reports the
 * page it ran in, credential slug and query string included), so it becomes
 * a route pattern. Anything that is not a source file is `[file]`.
 */
function codeLocation(file: string): string {
  const bare = file.split(/[?#]/, 1)[0] ?? "";
  if (!/^https?:\/\//i.test(bare)) return isRoutePattern(bare) ? bare : sourceFile(bare);
  const assets = bare.indexOf("/_next/");
  return assets === -1 ? routePattern(bare) : sourceFile(`app://${bare.slice(assets)}`);
}

/**
 * What `routePattern` returns for a page: every segment is a route directory
 * or `[param]`, so it holds nothing a visitor typed. It is kept as it is,
 * because every event is scrubbed twice (`beforeSend`, then the wire filter
 * in sentry-wire.ts) and the second pass must not turn the first pass's
 * route pattern into `[file]`.
 */
function isRoutePattern(path: string): boolean {
  return path.startsWith("/") && routePattern(path) === path;
}

function sourceFile(file: string): string {
  const known = SHAPE.codeFile.test(file) || SHAPE.nodeInternal.test(file) || file === "<anonymous>";
  return known ? redactText(file) : "[file]";
}

/** No local variables, no source lines, no module metadata: position only. */
function safeFrame(frame: Frame): Frame {
  return {
    ...(typeof frame.filename === "string" && { filename: codeLocation(frame.filename) }),
    ...(typeof frame.abs_path === "string" && { abs_path: codeLocation(frame.abs_path) }),
    ...(typeof frame.function === "string" && {
      function: SHAPE.functionName.test(frame.function) ? redactText(frame.function) : "?",
    }),
    ...pick(frame, ["lineno", "colno"], isFiniteNumber),
    ...pick(frame, ["in_app"], isBoolean),
  };
}

/**
 * Which uploaded source map belongs to which script file: a build's id and
 * the file it is for, nothing else. Without it Sentry cannot turn a minified
 * browser stack into source lines. The file goes through `codeLocation`, as
 * the frames' file names do, so the two still match.
 */
function safeDebugImages(images: readonly DebugImage[]): DebugImage[] {
  return images.flatMap((image) =>
    image.type === "sourcemap" && typeof image.code_file === "string" && shaped(SHAPE.debugId)(image.debug_id)
      ? [{ type: "sourcemap" as const, code_file: codeLocation(image.code_file), debug_id: image.debug_id }]
      : [],
  );
}

// --- Exceptions ------------------------------------------------------------------

function safeMechanism(mechanism: Mechanism): Mechanism {
  return {
    type: shaped(SHAPE.mechanism)(mechanism.type) ? mechanism.type : "generic",
    ...pick(mechanism, ["handled", "synthetic", "is_exception_group"], isBoolean),
    ...pick(mechanism, ["source"], shaped(SHAPE.mechanismSource)),
    ...pick(mechanism, ["exception_id", "parent_id"], isFiniteNumber),
  };
}

/**
 * An exception keeps its type and where it was thrown. Its message is
 * withheld, on the server and in the browser alike: a Prisma message quotes
 * the failed call's arguments, a JSON parse error quotes its input, and a
 * thrown object's "message" lists its keys.
 */
function safeException(entry: ExceptionEntry): ExceptionEntry {
  const frames = entry.stacktrace?.frames;
  return {
    type: shaped(SHAPE.errorType)(entry.type) ? redactText(entry.type) : "Error",
    value: shaped(SHAPE.withheldValue)(entry.value) ? entry.value : WITHHELD,
    ...(entry.mechanism != null && { mechanism: safeMechanism(entry.mechanism) }),
    ...(Array.isArray(frames) && { stacktrace: { frames: frames.map(safeFrame) } }),
  };
}

// --- Tags, extras, contexts ------------------------------------------------------

/**
 * Six tags, each with a closed shape. `route` and `method` come from the
 * app's own tags when it set them, and otherwise from the request the SDK
 * attached, which is then dropped whole: URL, query string, headers, cookies
 * and body.
 */
function safeTags(event: Event): EventTags {
  const tags: Record<string, unknown> = { ...event.tags };
  const request: Record<string, unknown> = { ...event.request };
  const route = typeof tags.route === "string" ? tags.route : request.url;
  const method = typeof tags.method === "string" ? tags.method : request.method;
  return {
    ...pick(tags, ["alert"], shaped(SHAPE.alarm)),
    ...(typeof route === "string" && { route: routePattern(route) }),
    ...(typeof method === "string" && HTTP_METHODS.has(method.toUpperCase()) && { method: method.toUpperCase() }),
    ...pick(tags, ["status"], shaped(SHAPE.status)),
    ...pick(tags, ["jobname"], shaped(SHAPE.jobName)),
    ...pick(tags, ["turbopack"], isBoolean),
  };
}

/**
 * Extras are counts and flags: a finite number or a boolean under an
 * identifier key. A string cannot travel here whoever set it, so the SDK's
 * `__serialized__` copy of a thrown object and any text an alarm's context
 * held are dropped by construction.
 */
export function numericExtra(extra: Event["extra"]): Record<string, number | boolean> {
  return Object.fromEntries(
    Object.entries(extra ?? {}).filter(
      (pair): pair is [string, number | boolean] =>
        SHAPE.extraKey.test(pair[0]) && (isBoolean(pair[1]) || isFiniteNumber(pair[1])),
    ),
  );
}

/** The trace ids and the runtime. No device, culture, app or request context. */
function safeContexts(contexts: EventContexts): EventContexts {
  const { trace, runtime } = contexts;
  const tracePart =
    trace != null && shaped(SHAPE.eventId)(trace.trace_id) && shaped(SHAPE.spanId)(trace.span_id)
      ? { trace: { trace_id: trace.trace_id, span_id: trace.span_id, ...pick(trace, ["parent_span_id"], shaped(SHAPE.spanId)) } }
      : {};
  const runtimePart = runtime != null ? { runtime: pick(runtime, ["name", "version"], shaped(SHAPE.label)) } : {};
  return { ...tracePart, ...runtimePart };
}

type SdkInfo = NonNullable<Event["sdk"]>;

function safeSdk(sdk: SdkInfo): SdkInfo {
  const isLabel = shaped(SHAPE.label);
  return {
    ...pick(sdk, ["name", "version"], isLabel),
    ...(Array.isArray(sdk.integrations) && { integrations: sdk.integrations.filter(isLabel) }),
    ...(Array.isArray(sdk.packages) && {
      packages: sdk.packages.filter((entry) => isLabel(entry.name) && isLabel(entry.version)).map(({ name, version }) => ({ name, version })),
    }),
  };
}

// --- The event -------------------------------------------------------------------

/**
 * A message is kept only when the alarm hook named it: the text equals the
 * `alert` tag, which `safeTags` has shape-checked. Any other message is free
 * text and is withheld; a cron job's name, when tagged, keeps separate jobs
 * apart in Sentry.
 */
function safeMessage(message: string, tags: EventTags): string {
  if (message === tags.alert) return message;
  return typeof tags.jobname === "string" ? `${WITHHELD} job ${tags.jobname}` : WITHHELD;
}

function safeTransaction(name: string): string | undefined {
  const match = SHAPE.transaction.exec(name);
  if (match === null) return undefined;
  const [, method, path = ""] = match;
  return method === undefined ? routePattern(path) : `${method} ${routePattern(path)}`;
}

function safeBody(event: Event, tags: EventTags): Pick<ErrorEvent, "message" | "exception" | "transaction"> {
  const values = event.exception?.values;
  const transaction = typeof event.transaction === "string" ? safeTransaction(event.transaction) : undefined;
  return {
    ...(typeof event.message === "string" && { message: safeMessage(event.message, tags) }),
    ...(Array.isArray(values) && { exception: { values: values.map(safeException) } }),
    ...(transaction !== undefined && { transaction }),
  };
}

/** Printed when the scrub drops an event it could not read. A literal: nothing from the event. */
const SCRUB_FAILED_LINE = JSON.stringify({ level: "error", message: "sentry_scrub_dropped_event" });

/** A plain object. Not null, text, a number, a list, bytes or a Date: none of those is an event. */
function isPlainObject(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * `beforeSend`, and the wire filter's rule for an event (sentry-wire.ts):
 * the event that is sent, built from the SDK's event.
 *
 * Errors only. A transaction, profile, replay or feedback event returns
 * null and is not sent. Not on the list, so not sent: `request` (URL, query
 * string, headers, cookies, body), `breadcrumbs`, `user`, `server_name`,
 * `modules`, `logentry`, `fingerprint`, `spans`, and
 * `sdkProcessingMetadata`, which holds the trace header's route name.
 *
 * Total: no input makes it throw. Whatever it is given, it returns an event
 * built from the allowlist, or null.
 */
export function scrubPii(event: Event, _hint?: EventHint): ErrorEvent | null {
  try {
    return isPlainObject(event) ? builtEvent(event) : null;
  } catch {
    // The one error this module swallows, and it does so on purpose. If
    // building the event throws (a null in `exception.values`, a getter that
    // throws, a shape a later SDK invents), no event exists that is known to
    // be safe. Dropping is the safe direction: one error report is lost. The
    // other direction is a leak, because the SDK reports a throw from
    // `beforeSend` as a NEW event that skips `beforeSend`
    // (@sentry/core client.js `_processEvent`, the `isInternalException`
    // branch). The caught error is not logged: its text is whatever the
    // event that caused it chose. The fixed line below is the only trace.
    console.error(SCRUB_FAILED_LINE);
    return null;
  }
}

function builtEvent(event: Event): ErrorEvent | null {
  if (event.type !== undefined) return null;
  const tags = safeTags(event);
  const extra = numericExtra(event.extra);
  const contexts = event.contexts != null ? safeContexts(event.contexts) : {};
  const images = Array.isArray(event.debug_meta?.images) ? safeDebugImages(event.debug_meta.images) : [];
  return {
    type: undefined,
    ...pick(event, ["event_id"], shaped(SHAPE.eventId)),
    ...pick(event, ["timestamp"], isFiniteNumber),
    ...pick(event, ["level"], isLevel),
    ...pick(event, ["platform", "environment", "release", "dist"], shaped(SHAPE.label)),
    ...safeBody(event, tags),
    ...(Object.keys(tags).length > 0 && { tags }),
    ...(Object.keys(extra).length > 0 && { extra }),
    ...(Object.keys(contexts).length > 0 && { contexts }),
    ...(event.sdk != null && { sdk: safeSdk(event.sdk) }),
    ...(images.length > 0 && { debug_meta: { images } }),
  };
}

/** For every SDK hook whose answer is "do not send this": breadcrumbs, transactions. */
export function sendNothing(): null {
  return null;
}

/**
 * The integrations kept from the SDK's defaults, in every runtime: capture
 * an error, chain its causes, drop duplicates and noise, and (server) note
 * the request so the scrub can name its route. Everything else stays off,
 * and a default a later SDK version adds stays off until it is named here.
 * Left out on purpose: Breadcrumbs and Console (clicks, console arguments,
 * fetch and navigation URLs), BrowserSession and ProcessSession (a ping per
 * page view), HttpContext (the page URL and referrer, attached even to an
 * event that skips `beforeSend`), BrowserApiErrors (it copies a callback's
 * arguments into `extra`), CultureContext and Context (locale, timezone,
 * device), ContextLines, LocalVariables, Modules, NodeSystemError (a failed
 * file's path) and every tracing integration. The server adds its own Http
 * integration (sentry.server.config.ts).
 */
const KEPT_INTEGRATIONS: ReadonlySet<string> = new Set([
  "InboundFilters",
  "EventFilters",
  "FunctionToString",
  "LinkedErrors",
  "Dedupe",
  "GlobalHandlers",
  "NextjsClientStackFrameNormalization",
  "DistDirRewriteFrames",
  "OnUncaughtException",
  "OnUnhandledRejection",
  "RequestData",
]);

export function errorOnlyIntegrations<I extends { name: string }>(defaults: readonly I[]): I[] {
  return defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name));
}

/**
 * The options every runtime's `init` spreads. No breadcrumb is recorded, so
 * none can ride on an event that skips `beforeSend` (an SDK-internal error
 * does). No client report and no default PII. Transactions are refused here
 * as well as by `tracesSampleRate: 0`.
 */
export const PRIVATE_REPORTING_OPTIONS = {
  sendDefaultPii: false,
  sendClientReports: false,
  maxBreadcrumbs: 0,
  beforeBreadcrumb: sendNothing,
  beforeSend: scrubPii,
  beforeSendTransaction: sendNothing,
} as const;

// --- What the app's own server captures add ---------------------------------------

/** What a server error report may say about where it happened. */
export interface ServerEventMeta {
  route?: string;
  method?: string;
  status?: number;
  /** A Prisma, Node or SQLSTATE code from `errorForLog`, never a message. */
  errorCode?: string;
}

function serverTags(meta: ServerEventMeta): Record<string, string> {
  return {
    ...(meta.route !== undefined && { route: meta.route }),
    ...(meta.method !== undefined && { method: meta.method }),
    ...(meta.status !== undefined && { status: String(meta.status) }),
  };
}

function withholdMessages(values: ExceptionEntry[] | undefined, errorCode: string | undefined): ExceptionEntry[] | undefined {
  const value = errorCode === undefined ? WITHHELD : `${WITHHELD} code ${errorCode}`;
  return values?.map((entry) => ({ ...entry, value }));
}

/**
 * An event processor for the reports the server raises itself: route errors,
 * request errors, alarm lines and a failed boot. It names the route pattern,
 * method, status and error code, which `scrubPii` cannot know, and it drops
 * the request, the breadcrumbs, the user and every non-numeric extra before
 * the scrub sees the event. The scrub still runs after it, on this and on
 * every event the SDK captures by itself.
 */
export function withheldServerEvent(meta: ServerEventMeta): <E extends Event>(event: E) => E {
  return <E extends Event>(event: E): E => ({
    ...event,
    request: undefined,
    breadcrumbs: undefined,
    user: undefined,
    extra: numericExtra(event.extra),
    tags: { ...event.tags, ...serverTags(meta) },
    ...(meta.route !== undefined && { transaction: `${meta.method ?? ""} ${meta.route}`.trim() }),
    ...(event.exception !== undefined && {
      exception: { ...event.exception, values: withholdMessages(event.exception.values, meta.errorCode) },
    }),
  });
}
