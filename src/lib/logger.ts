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
  } else {
    console.log(formatted);
  }
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
