import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBackfillTarget } from "./backfill-target-guard.mjs";

const LOCAL = "postgresql://postgres:secret@localhost:5432/visionquest";
const LOCAL_V6 = "postgresql://postgres:secret@[::1]:5432/visionquest";
const REMOTE = "postgresql://postgres.abc:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const REMOTE_HOST = "aws-0-us-east-1.pooler.supabase.com";

describe("checkBackfillTarget", () => {
  it("allows a loopback target with --apply and no confirm", () => {
    const check = checkBackfillTarget({ databaseUrls: [LOCAL, LOCAL_V6], apply: true, confirmHost: undefined });
    assert.equal(check.allowed, true);
    assert.deepEqual(check.hosts, ["localhost", "[::1]"]);
  });

  it("refuses a remote target with --apply and no --confirm-host", () => {
    const check = checkBackfillTarget({ databaseUrls: [REMOTE], apply: true, confirmHost: undefined });
    assert.equal(check.allowed, false);
    assert.match(check.reason, new RegExp(`--confirm-host=${REMOTE_HOST.replace(/\./g, "\\.")}`));
  });

  it("allows a remote target with --apply and a matching --confirm-host", () => {
    const check = checkBackfillTarget({ databaseUrls: [REMOTE, REMOTE], apply: true, confirmHost: REMOTE_HOST });
    assert.equal(check.allowed, true);
  });

  it("refuses a mismatched --confirm-host", () => {
    const check = checkBackfillTarget({ databaseUrls: [REMOTE], apply: true, confirmHost: "db.example.org" });
    assert.equal(check.allowed, false);
    assert.match(check.reason, /does not match/);
  });

  it("refuses when one of two remote hosts is not the confirmed one", () => {
    const check = checkBackfillTarget({
      databaseUrls: [REMOTE, "postgresql://u:p@other.example.org/db"],
      apply: true,
      confirmHost: REMOTE_HOST,
    });
    assert.equal(check.allowed, false);
  });

  it("refuses an unparseable URL with --apply", () => {
    const check = checkBackfillTarget({ databaseUrls: ["not a url"], apply: true, confirmHost: undefined });
    assert.equal(check.allowed, false);
    assert.deepEqual(check.hosts, ["(unparseable)"]);
  });

  it("never refuses a dry run, remote or not", () => {
    for (const databaseUrls of [[REMOTE], [LOCAL], ["not a url"]]) {
      assert.equal(checkBackfillTarget({ databaseUrls, apply: false, confirmHost: undefined }).allowed, true);
    }
  });

  it("reports hosts only, never credentials", () => {
    const check = checkBackfillTarget({ databaseUrls: [REMOTE], apply: true, confirmHost: undefined });
    assert.equal(JSON.stringify(check).includes("secret"), false);
    assert.equal(JSON.stringify(check).includes("postgres.abc"), false);
  });
});
