import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAudit, ghsaFromUrl } from "./audit-allowlist";

// ---------------------------------------------------------------------------
// VQ-R-021 follow-up — the dated allowlist behind `npm run audit:deps`.
//
// The security job this PR introduced caught 8 real high advisories on its first
// run. One (GHSA-mh99-v99m-4gvg, brace-expansion) cannot be fixed: the tree
// holds minimatch@3 (needs brace-expansion 1.x) and minimatch@10 (ships 5.x),
// so a blanket override throws "expand is not a function" in eslint, and
// `npm audit fix --force` only resolves it by installing eslint 10.
//
// Rather than weakening the gate to --audit-level=critical, an advisory may be
// allowlisted WITH AN EXPIRY DATE. The expiry is the whole point: a permanent
// exception is indistinguishable from a disabled gate, so an expired entry
// FAILS the build and forces the decision to be retaken.
// ---------------------------------------------------------------------------

const TODAY = new Date("2026-07-30T00:00:00Z");

function advisory(url: string, severity = "high", title = "t") {
  return { url, severity, title };
}

/** Minimal shape of `npm audit --json` for the fields we read. */
function auditReport(...advisories: ReturnType<typeof advisory>[]) {
  return {
    vulnerabilities: {
      pkg: { severity: "high", via: advisories },
    },
  };
}

describe("ghsaFromUrl", () => {
  it("extracts the GHSA id", () => {
    assert.equal(
      ghsaFromUrl("https://github.com/advisories/GHSA-mh99-v99m-4gvg"),
      "GHSA-mh99-v99m-4gvg",
    );
  });

  it("returns null for a non-advisory url", () => {
    assert.equal(ghsaFromUrl("https://example.com/nope"), null);
    assert.equal(ghsaFromUrl(undefined), null);
  });
});

describe("evaluateAudit — gating (VQ-R-021)", () => {
  it("passes when there are no high or critical advisories", () => {
    const r = evaluateAudit(auditReport(advisory("https://x/GHSA-aaaa-aaaa-aaaa", "moderate")), [], TODAY);
    assert.equal(r.ok, true);
    assert.deepEqual(r.blocking, []);
  });

  it("fails on a high advisory that is not allowlisted", () => {
    const r = evaluateAudit(auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")), [], TODAY);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocking.map((b) => b.id), ["GHSA-mh99-v99m-4gvg"]);
  });

  it("fails on a critical advisory even when allowlisted", () => {
    // Critical is never waivable — an allowlist is for accepted risk, and
    // nothing about a critical is acceptable to defer silently.
    const r = evaluateAudit(
      auditReport(advisory("https://github.com/advisories/GHSA-crit-crit-crit", "critical")),
      [{ id: "GHSA-crit-crit-crit", reason: "r", expires: "2099-01-01" }],
      TODAY,
    );
    assert.equal(r.ok, false);
    assert.match(r.blocking[0].why, /critical/i);
  });

  it("passes a high advisory that is allowlisted and unexpired", () => {
    const r = evaluateAudit(
      auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")),
      [{ id: "GHSA-mh99-v99m-4gvg", reason: "build-time glob DoS", expires: "2026-10-31" }],
      TODAY,
    );
    assert.equal(r.ok, true);
    assert.equal(r.waived.length, 1);
    assert.equal(r.waived[0].daysLeft, 93);
  });

  it("FAILS when the allowlist entry has expired", () => {
    // The core guarantee. A stale waiver must break the build, not linger.
    const r = evaluateAudit(
      auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")),
      [{ id: "GHSA-mh99-v99m-4gvg", reason: "r", expires: "2026-07-29" }],
      TODAY,
    );
    assert.equal(r.ok, false);
    assert.match(r.blocking[0].why, /expired/i);
  });

  it("fails on the expiry date itself, not the day after", () => {
    const r = evaluateAudit(
      auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")),
      [{ id: "GHSA-mh99-v99m-4gvg", reason: "r", expires: "2026-07-30" }],
      TODAY,
    );
    assert.equal(r.ok, false, "an entry expiring today is already expired");
  });

  it("rejects an allowlist entry with a missing or malformed expiry", () => {
    for (const expires of ["", "soon", "2026-13-45", undefined as unknown as string]) {
      const r = evaluateAudit(
        auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")),
        [{ id: "GHSA-mh99-v99m-4gvg", reason: "r", expires }],
        TODAY,
      );
      assert.equal(r.ok, false, `expires=${JSON.stringify(expires)} must not waive anything`);
    }
  });

  it("rejects an allowlist entry with no stated reason", () => {
    const r = evaluateAudit(
      auditReport(advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg")),
      [{ id: "GHSA-mh99-v99m-4gvg", reason: "  ", expires: "2026-10-31" }],
      TODAY,
    );
    assert.equal(r.ok, false, "a waiver with no reason is not a decision");
  });

  it("reports a stale allowlist entry that matches nothing, without failing", () => {
    // The advisory was fixed: the waiver should be deleted, but a resolved
    // vulnerability must never break the build.
    const r = evaluateAudit(
      auditReport(advisory("https://x/GHSA-aaaa-aaaa-aaaa", "moderate")),
      [{ id: "GHSA-dead-dead-dead", reason: "r", expires: "2026-10-31" }],
      TODAY,
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.stale, ["GHSA-dead-dead-dead"]);
  });

  it("still blocks other advisories when one is waived", () => {
    const r = evaluateAudit(
      auditReport(
        advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg"),
        advisory("https://github.com/advisories/GHSA-new1-new1-new1"),
      ),
      [{ id: "GHSA-mh99-v99m-4gvg", reason: "r", expires: "2026-10-31" }],
      TODAY,
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocking.map((b) => b.id), ["GHSA-new1-new1-new1"]);
  });

  it("fails closed on a high advisory with no resolvable GHSA id", () => {
    // An advisory we cannot identify cannot be matched against the allowlist,
    // so it must never be silently skipped.
    const r = evaluateAudit(auditReport(advisory("", "high")), [], TODAY);
    assert.equal(r.ok, false);
    assert.match(r.blocking[0].id, /unidentified/i);
  });

  it("deduplicates one advisory reported across many consumers", () => {
    // npm lists every dependent of a vulnerable package, so a single root
    // advisory can appear a dozen times. It should count once.
    const same = advisory("https://github.com/advisories/GHSA-mh99-v99m-4gvg");
    const report = {
      vulnerabilities: {
        eslint: { severity: "high", via: [same] },
        glob: { severity: "high", via: [same] },
        minimatch: { severity: "high", via: [same] },
      },
    };
    const r = evaluateAudit(report, [], TODAY);
    assert.equal(r.blocking.length, 1, "one root advisory, not three");
  });
});
