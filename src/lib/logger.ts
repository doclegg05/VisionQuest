import { errorForLog } from "./log-error";
import { numericExtra, withheldServerEvent } from "./sentry-scrub";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const IS_PROD = process.env.NODE_ENV === "production";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function formatEntry(entry: LogEntry): string {
  if (IS_PROD) {
    return JSON.stringify(entry);
  }
  const { timestamp, level, message, ...rest } = entry;
  const ctx = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${timestamp} [${level.toUpperCase()}] ${message}${ctx}`;
}

/**
 * A log line's structured fields. The raw student-identifier keys are typed
 * `never`, so a context object that carries one fails to compile even when it
 * is built elsewhere and spread in, where the ESLint key selectors cannot see
 * it (.claude/rules/security.md, Data Privacy). Log studentLogKey(id) from
 * src/lib/log-keys.ts instead. `message` is the entry's own field, which a
 * context key would overwrite.
 */
export type LogContext = Record<string, unknown> & {
  studentId?: never;
  targetStudentId?: never;
  userId?: never;
  message?: never;
};

function log(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const formatted = formatEntry(entry);
  if (level === "error" || level === "warn") {
    console.error(formatted);
    reportAlarm(level, message, context);
  } else {
    console.log(formatted);
  }
}

// --- Alarm lines reach a person (H1, 2026-11-10) ---------------------------

/** An alarm name: a snake_case identifier, as every call site writes one. */
const ALARM_NAME = /^[a-z][a-z0-9_]{2,63}$/;
/** Boot probes name the alarm in the message instead (src/lib/boot-probes.ts). */
const ALARM_MESSAGE_PREFIX = "boot_probe_";

/**
 * Which warn or error lines are alarms: the `alert: "<name>"` field the call
 * sites use (wellbeing_no_recipients, email_delivery_unconfigured, ...), or a
 * boot_probe_* message. An `alert` value that is not an identifier is sent
 * as `unnamed_alert` rather than as text, since text could carry anything.
 */
function alarmName(message: string, context: LogContext | undefined): string | undefined {
  const alert = context?.alert;
  if (typeof alert === "string") return ALARM_NAME.test(alert) ? alert : "unnamed_alert";
  return message.startsWith(ALARM_MESSAGE_PREFIX) && ALARM_NAME.test(message) ? message : undefined;
}

/**
 * What travels with an alarm: counts and flags. The type cannot hold a
 * string, and `numericExtra` builds it by dropping everything that is not a
 * finite number or a boolean, so a studentLogKey, an error name or free text
 * in the log context stays in the log line. The scrub applies the same
 * filter again to every event (src/lib/sentry-scrub.ts).
 */
type AlarmExtra = Record<string, number | boolean>;

/** At most one report per alarm name in this long. */
const ALARM_WINDOW_MS = 60_000;

interface AlarmWindow {
  sentAt: number;
  heldBack: number;
}

const alarmWindows = new Map<string, AlarmWindow>();

/**
 * Decides whether this alarm is reported. Two alarms sit on hot paths
 * (`audit_write_failed` on every audited read while the audit table is
 * down, `wellbeing_detection_failed` on every chat message), and an outage
 * would otherwise send one event per request. At most one report per alarm
 * name per process per minute: returns how many were held back since the
 * last report, or undefined when this one is held back too. The count
 * travels on the next report, so a flood that stops within its minute shows
 * as one event; the log stream has every line.
 */
function admitAlarm(name: string, now: number): number | undefined {
  const last = alarmWindows.get(name);
  if (last !== undefined && now - last.sentAt < ALARM_WINDOW_MS) {
    alarmWindows.set(name, { sentAt: last.sentAt, heldBack: last.heldBack + 1 });
    return undefined;
  }
  alarmWindows.set(name, { sentAt: now, heldBack: 0 });
  return last?.heldBack ?? 0;
}

/**
 * Sends an alarm line to Sentry as a message. With no SENTRY_DSN it returns
 * before loading anything. The SDK is imported lazily so that scripts and
 * any bundle that reach this logger do not load it at all unless an alarm
 * fires; on the server it is already in memory from instrumentation.ts.
 * The message is the alarm name, never the log message.
 */
function reportAlarm(level: "warn" | "error", message: string, context: LogContext | undefined): void {
  if (!process.env.SENTRY_DSN) return;
  const name = alarmName(message, context);
  if (name === undefined) return;
  const heldBack = admitAlarm(name, Date.now());
  if (heldBack === undefined) return;
  const extra: AlarmExtra = { ...numericExtra(context), heldBack };
  import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.withScope((scope) => {
        scope.addEventProcessor(withheldServerEvent({}));
        scope.setTag("alert", name);
        scope.setExtras(extra);
        Sentry.captureMessage(name, level === "error" ? "error" : "warning");
      }),
    )
    .catch((error: unknown) => {
      // Not through `log`, which could report this failure again.
      console.error(JSON.stringify({ level: "error", message: "alarm_report_failed", error: errorForLog(error) }));
    });
}

export const logger = {
  debug: (message: string, context?: LogContext) => log("debug", message, context),
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),
};

let counter = 0;
export function requestId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}
