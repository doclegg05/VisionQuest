/**
 * Host guard for one-off data backfills (first user:
 * scripts/job-preferences-backfill.mjs, W4 fix round 1).
 *
 * Backfill scripts call loadEnvFile(), which on Britt's machine (and in any
 * worktree whose .env.local is a symlink to the main checkout) loads the
 * PRODUCTION connection strings. A dry run only reads, so it always runs.
 * A write (--apply) to a host that is not loopback needs an explicit
 * --confirm-host=<host> naming every remote host, so production is never
 * written by accident. Same idea as assertSafeE2eSeedTarget in
 * src/lib/e2e-seed-guard.ts.
 *
 * Pure: parses connection strings and returns hosts only, never a full URL,
 * a user name or a password. Call it before opening any connection.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const UNPARSEABLE = "(unparseable)";

function hostOf(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname || UNPARSEABLE;
  } catch {
    return UNPARSEABLE;
  }
}

/**
 * @param {{ databaseUrls: string[], apply: boolean, confirmHost: string | undefined }} input
 * @returns {{ allowed: boolean, hosts: string[], reason: string | null }}
 */
export function checkBackfillTarget({ databaseUrls, apply, confirmHost }) {
  const hosts = databaseUrls.map(hostOf);
  if (!apply) return { allowed: true, hosts, reason: null };

  if (hosts.includes(UNPARSEABLE)) {
    return { allowed: false, hosts, reason: "a database connection string could not be parsed" };
  }
  const remote = [...new Set(hosts.filter((host) => !LOOPBACK_HOSTS.has(host)))];
  if (remote.length === 0) return { allowed: true, hosts, reason: null };

  if (!confirmHost) {
    return {
      allowed: false,
      hosts,
      reason: `writing to a remote host needs --confirm-host=${remote[0]} together with --apply`,
    };
  }
  const unconfirmed = remote.filter((host) => host !== confirmHost);
  if (unconfirmed.length > 0) {
    return {
      allowed: false,
      hosts,
      reason: `--confirm-host=${confirmHost} does not match the target host ${unconfirmed[0]}`,
    };
  }
  return { allowed: true, hosts, reason: null };
}
