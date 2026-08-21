import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { assertSafeE2eSeedTarget, isSafeE2eSeedTarget } from "./e2e-seed-guard";

// ---------------------------------------------------------------------------
// W4 — scripts/seed-e2e-users.ts creates a teacher account with a
// git-committed password (see e2e/fixtures.ts) against whatever DATABASE_URL
// happens to resolve. This guard must refuse anything that isn't clearly
// local or CI-scoped, BEFORE a connection is opened — these tests never
// touch a real database, only parse a connection string, proving the guard
// runs pre-connect by construction.
// ---------------------------------------------------------------------------

describe("isSafeE2eSeedTarget", () => {
  it("allows localhost", () => {
    assert.equal(isSafeE2eSeedTarget("postgresql://user:pass@localhost:5432/vq_dev").allowed, true);
  });

  it("allows 127.0.0.1", () => {
    assert.equal(
      isSafeE2eSeedTarget("postgresql://user:pass@127.0.0.1:5432/vq_dev").allowed,
      true,
    );
  });

  it("allows a database name ending in _ci on a non-local host", () => {
    assert.equal(
      isSafeE2eSeedTarget("postgresql://user:pass@db.internal.example.com:5432/vq_ci").allowed,
      true,
    );
  });

  it("allows a database name ending in _local on a non-local host", () => {
    assert.equal(
      isSafeE2eSeedTarget("postgresql://user:pass@db.internal.example.com:5432/vq_local").allowed,
      true,
    );
  });

  it("refuses a remote-looking production host (fake remote URL — no real connection needed)", () => {
    const check = isSafeE2eSeedTarget(
      "postgresql://vq_app:secret@prod-db.render.com:5432/visionquest_production",
    );
    assert.equal(check.allowed, false);
    assert.equal(check.host, "prod-db.render.com");
  });

  it("refuses an unparseable connection string", () => {
    const check = isSafeE2eSeedTarget("not-a-connection-string");
    assert.equal(check.allowed, false);
  });
});

describe("assertSafeE2eSeedTarget", () => {
  it("throws for a remote host with no override — the default refusal path", () => {
    assert.throws(
      () =>
        assertSafeE2eSeedTarget(
          "postgresql://vq_app:secret@prod-db.render.com:5432/visionquest_production",
          { allowRemote: false },
        ),
      /prod-db\.render\.com/,
    );
  });

  it("does not throw for localhost", () => {
    assert.doesNotThrow(() =>
      assertSafeE2eSeedTarget("postgresql://user:pass@localhost:5432/vq_dev", {
        allowRemote: false,
      }),
    );
  });

  it("does not throw for a _ci-suffixed database name", () => {
    assert.doesNotThrow(() =>
      assertSafeE2eSeedTarget("postgresql://user:pass@ci-runner-db:5432/vq_ci", {
        allowRemote: false,
      }),
    );
  });

  it("--allow-remote overrides the refusal and prints a warning naming the host", () => {
    const warn = mock.fn();
    assert.doesNotThrow(() =>
      assertSafeE2eSeedTarget(
        "postgresql://vq_app:secret@prod-db.render.com:5432/visionquest_production",
        { allowRemote: true, warn },
      ),
    );
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /prod-db\.render\.com/);
  });

  it("does not warn when the target is already safe, even with allowRemote true", () => {
    const warn = mock.fn();
    assertSafeE2eSeedTarget("postgresql://user:pass@localhost:5432/vq_dev", {
      allowRemote: true,
      warn,
    });
    assert.equal(warn.mock.callCount(), 0);
  });
});
