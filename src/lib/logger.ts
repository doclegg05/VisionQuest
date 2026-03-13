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

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
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
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};

let counter = 0;
export function requestId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}
