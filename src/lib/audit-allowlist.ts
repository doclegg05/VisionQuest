/**
 * Dated allowlist for `npm audit`, behind `npm run audit:deps`.
 *
 * VQ-R-021 added dependency scanning and it immediately caught 8 real high
 * advisories that had been sitting in main undetected. One of them cannot be
 * fixed: GHSA-mh99-v99m-4gvg (brace-expansion) needs 5.0.8, but the tree holds
 * minimatch@3 (which needs brace-expansion 1.x) alongside minimatch@10 (which
 * ships 5.x), so a blanket override throws "expand is not a function" in
 * eslint, and `npm audit fix --force` only clears it by installing eslint 10.
 *
 * The options were: leave the check permanently red, or drop it to
 * --audit-level=critical and stop reporting eight classes of high advisory. Both
 * are the failure this project's review was about — an instrument that reports
 * success without enforcing anything.
 *
 * So an advisory may be waived, but only with a written reason AND an expiry
 * date. The expiry is the mechanism, not decoration: an expired waiver FAILS the
 * build, which forces the decision to be retaken instead of forgotten. A
 * permanent exception is indistinguishable from a disabled gate.
 *
 * Deliberate asymmetries:
 *   - critical is never waivable
 *   - an advisory whose GHSA id cannot be resolved fails closed
 *   - a waiver that matches no live advisory is reported as stale but does NOT
 *     fail, because a fixed vulnerability must never break the build
 */

export interface AllowlistEntry {
  /** GHSA identifier, e.g. "GHSA-mh99-v99m-4gvg". */
  id: string;
  /** Why this risk is accepted. Required — a waiver without one is not a decision. */
  reason: string;
  /** ISO date (YYYY-MM-DD). On or after this date the waiver stops working. */
  expires: string;
  /** Optional pointer to the tracking issue or finding. */
  ref?: string;
}

interface AuditVia {
  url?: string;
  severity?: string;
  title?: string;
}

interface AuditReportLike {
  vulnerabilities?: Record<string, { severity?: string; via?: (AuditVia | string)[] }>;
}

export interface BlockingAdvisory {
  id: string;
  title: string;
  severity: string;
  why: string;
}

export interface WaivedAdvisory {
  id: string;
  title: string;
  reason: string;
  expires: string;
  daysLeft: number;
}

export interface AuditVerdict {
  ok: boolean;
  blocking: BlockingAdvisory[];
  waived: WaivedAdvisory[];
  /** Allowlist ids that matched no live advisory — delete them. */
  stale: string[];
}

const GHSA_RE = /(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Pull the GHSA id out of an advisory URL. Returns null when absent. */
export function ghsaFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = GHSA_RE.exec(url);
  // Returned verbatim — GHSA ids are conventionally lower-case and callers
  // display them. Comparison is done case-insensitively by the caller.
  return m ? m[1] : null;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value || !ISO_DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against JS date rollover ("2026-13-45" would otherwise slide forward).
  if (d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

/**
 * Decide whether an `npm audit --json` report passes, given a dated allowlist.
 * Pure: the caller supplies `now`, so the expiry logic is testable.
 */
export function evaluateAudit(
  report: AuditReportLike,
  allowlist: AllowlistEntry[],
  now: Date,
): AuditVerdict {
  const byId = new Map<string, AllowlistEntry>();
  for (const entry of allowlist) {
    if (entry?.id) byId.set(entry.id.toUpperCase(), entry);
  }

  // One root advisory is reported once per dependent package, so collapse on id.
  const seen = new Map<string, { id: string; title: string; severity: string }>();
  let unidentified = 0;

  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === "string") continue;
      const severity = (via.severity ?? "").toLowerCase();
      if (severity !== "high" && severity !== "critical") continue;

      const id = ghsaFromUrl(via.url);
      if (!id) {
        unidentified += 1;
        continue;
      }
      const key = id.toUpperCase();
      const prior = seen.get(key);
      // critical wins if the same id is reported at mixed severities.
      if (!prior || (prior.severity !== "critical" && severity === "critical")) {
        seen.set(key, { id, title: via.title ?? id, severity });
      }
    }
  }

  const blocking: BlockingAdvisory[] = [];
  const waived: WaivedAdvisory[] = [];
  const matched = new Set<string>();

  for (const [key, { id, title, severity }] of seen) {
    const entry = byId.get(key);
    if (entry) matched.add(key);

    if (severity === "critical") {
      blocking.push({
        id,
        title,
        severity,
        why: entry
          ? "critical advisories cannot be waived — the allowlist entry is ignored"
          : "critical advisory",
      });
      continue;
    }

    if (!entry) {
      blocking.push({ id, title, severity, why: "not allowlisted" });
      continue;
    }

    if (!entry.reason || !entry.reason.trim()) {
      blocking.push({ id, title, severity, why: "allowlist entry has no reason" });
      continue;
    }

    const expires = parseIsoDate(entry.expires);
    if (!expires) {
      blocking.push({
        id,
        title,
        severity,
        why: `allowlist entry has a missing or malformed expiry (${JSON.stringify(entry.expires ?? null)}) — use YYYY-MM-DD`,
      });
      continue;
    }

    // Expiring "on" a date means the waiver is spent that morning.
    const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / MS_PER_DAY);
    if (daysLeft <= 0) {
      blocking.push({
        id,
        title,
        severity,
        why: `allowlist entry expired on ${entry.expires} — re-decide it, do not just push the date out`,
      });
      continue;
    }

    waived.push({ id, title, reason: entry.reason.trim(), expires: entry.expires, daysLeft });
  }

  if (unidentified > 0) {
    blocking.push({
      id: `unidentified-advisory (${unidentified})`,
      title: "high/critical advisory with no resolvable GHSA id",
      severity: "high",
      why: "cannot be matched against the allowlist, so it fails closed",
    });
  }

  // Report the id as the author wrote it, not the upper-cased lookup key.
  const stale = [...byId.entries()]
    .filter(([key]) => !matched.has(key))
    .map(([, entry]) => entry.id)
    .sort();

  return { ok: blocking.length === 0, blocking, waived, stale };
}
