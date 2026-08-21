/**
 * Refuses to run the e2e fixture seed (scripts/seed-e2e-users.ts) against a
 * database that isn't clearly local or CI-scoped.
 *
 * That seed upserts a teacher account (and two student accounts) with
 * passwords that are hard-coded in a git-tracked file (e2e/fixtures.ts) —
 * fine against a hermetic CI Postgres or a developer's local DB, actively
 * dangerous against anything else DATABASE_URL might resolve to (a shared
 * dev DB, or worse, prod), since the credentials are public the moment
 * they're committed.
 *
 * Pure and side-effect-free by design: this only parses a connection
 * string, so it can — and must — run BEFORE the script opens any real
 * database connection.
 */

export interface SeedTargetCheck {
  allowed: boolean;
  host: string;
  database: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Database names that self-identify as CI or local-only scoped. */
const CI_OR_LOCAL_DB_NAME_RE = /(_ci|_local)$/i;

function parseConnectionTarget(databaseUrl: string): { host: string; database: string } {
  // `new URL` accepts both postgres:// and postgresql:// (and rejects a
  // non-URL string, which is exactly the "unparseable" case we want to
  // refuse rather than guess about).
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    database: url.pathname.replace(/^\//, ""),
  };
}

/**
 * True when `databaseUrl` looks safe for the e2e seed without an explicit
 * override: a local host, or a database name that flags itself as
 * CI/local-scoped (`*_ci`, `*_local`).
 */
export function isSafeE2eSeedTarget(databaseUrl: string): SeedTargetCheck {
  let host: string;
  let database: string;
  try {
    ({ host, database } = parseConnectionTarget(databaseUrl));
  } catch {
    return { allowed: false, host: "(unparseable)", database: "(unparseable)" };
  }

  const allowed = LOCAL_HOSTS.has(host) || CI_OR_LOCAL_DB_NAME_RE.test(database);
  return { allowed, host, database };
}

/**
 * Guard entry point for scripts/seed-e2e-users.ts. Call this BEFORE
 * constructing a PrismaClient / opening any connection.
 *
 * Throws unless the target is safe (see isSafeE2eSeedTarget) or the caller
 * explicitly passed `--allow-remote` (`allowRemote: true`), in which case it
 * prints a loud warning naming the host and proceeds.
 */
export function assertSafeE2eSeedTarget(
  databaseUrl: string,
  options: { allowRemote: boolean; warn?: (message: string) => void },
): void {
  const { allowRemote, warn = console.warn } = options;
  const check = isSafeE2eSeedTarget(databaseUrl);
  if (check.allowed) return;

  if (allowRemote) {
    warn(
      `WARNING: seeding e2e fixtures — including a teacher account whose password is ` +
        `hard-coded in a git-tracked file (e2e/fixtures.ts) — against host "${check.host}" ` +
        `(database "${check.database}"), which is neither local nor CI/local-scoped. ` +
        `Proceeding because --allow-remote was passed.`,
    );
    return;
  }

  throw new Error(
    `Refusing to seed e2e fixtures against host "${check.host}" (database "${check.database}"). ` +
      `This does not look like localhost or a *_ci/*_local database, and the seed creates ` +
      `accounts with git-committed passwords (e2e/fixtures.ts). Pass --allow-remote to override.`,
  );
}
