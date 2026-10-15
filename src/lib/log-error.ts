/**
 * What a caught error may put in a server log: its name and its code, never
 * its message.
 *
 * Prisma messages echo the failed call's arguments, so a failed alert upsert
 * quotes its alertKey (`evidence_gap:<studentId>:<requirementId>`) and a
 * validation error prints the whole `where` clause. Server logs carry no
 * student identifier at any level (.claude/rules/security.md, Data Privacy),
 * and the ESLint key-name selectors cannot see inside a message, so the
 * message stays out entirely. The name and the Prisma code (P2002, P2025,
 * P1001...) still say what kind of failure it was.
 *
 * Pair with studentLogKey() from src/lib/log-keys.ts when a failure needs a
 * correlation key.
 */
export interface LoggedCause {
  name: string;
  code?: string;
}

export interface LoggedError extends LoggedCause {
  /** One level only: enough for "fetch failed" to say ECONNREFUSED. */
  cause?: LoggedCause;
}

/**
 * `code` is a free-form property any library may set, so only the known
 * shapes are kept: Prisma's P plus four digits (P2002), Node's E-codes
 * (ECONNREFUSED, ERR_INVALID_URL) and five-character Postgres SQLSTATEs
 * (42501). A cuid, a phone number or a login id fails all three.
 */
const CODE_SHAPE = /^(P\d{4}|E[A-Z_]{2,40}|[0-9A-Z]{5})$/;

/** A class name. A custom error can set `name` to any text, an id included. */
const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function codeOf(error: Error): string | undefined {
  // PrismaClientKnownRequestError sets `code`; PrismaClientInitializationError
  // (database unreachable, P1001) sets `errorCode`.
  const candidate = "code" in error ? error.code : "errorCode" in error ? error.errorCode : undefined;
  return typeof candidate === "string" && CODE_SHAPE.test(candidate) ? candidate : undefined;
}

function summarize(error: unknown): LoggedCause {
  if (!(error instanceof Error)) {
    return { name: error === null ? "null" : typeof error };
  }

  const name = typeof error.name === "string" && NAME_SHAPE.test(error.name) ? error.name : "Error";
  const code = codeOf(error);
  return code ? { name, code } : { name };
}

export function errorForLog(error: unknown): LoggedError {
  const summary = summarize(error);
  if (!(error instanceof Error) || error.cause === undefined) {
    return summary;
  }

  return { ...summary, cause: summarize(error.cause) };
}
