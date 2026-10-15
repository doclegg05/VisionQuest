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
export interface LoggedError {
  name: string;
  code?: string;
}

/**
 * `code` is a free-form property any library may set. Prisma's are P plus
 * four digits, Node's are uppercase (ECONNRESET), and Postgres SQLSTATEs are
 * five characters, so anything else (a lowercase cuid included) is dropped
 * rather than trusted.
 */
const CODE_SHAPE = /^[A-Z0-9_]{1,32}$/;

function codeOf(error: Error): string | undefined {
  // PrismaClientKnownRequestError sets `code`; PrismaClientInitializationError
  // (database unreachable, P1001) sets `errorCode`.
  const candidate = "code" in error ? error.code : "errorCode" in error ? error.errorCode : undefined;
  return typeof candidate === "string" && CODE_SHAPE.test(candidate) ? candidate : undefined;
}

export function errorForLog(error: unknown): LoggedError {
  if (!(error instanceof Error)) {
    return { name: error === null ? "null" : typeof error };
  }

  const code = codeOf(error);
  return code ? { name: error.name, code } : { name: error.name };
}
