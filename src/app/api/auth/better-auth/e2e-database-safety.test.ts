import assert from "node:assert/strict";
import test from "node:test";
import { assertDisposableE2eDatabaseUrl } from "@/lib/e2e-database-safety";

test("E2E fixtures refuse an unconfirmed loopback database", () => {
  assert.throws(
    () =>
      assertDisposableE2eDatabaseUrl(
        "postgresql://postgres:synthetic@127.0.0.1:5432/visionquest_e2e",
        undefined,
      ),
    /confirmed disposable/i,
  );
});

test("E2E fixtures refuse a confirmed loopback database without a dedicated E2E name", () => {
  assert.throws(
    () =>
      assertDisposableE2eDatabaseUrl(
        "postgresql://postgres:synthetic@localhost:5432/visionquest",
        "true",
      ),
    /dedicated.*e2e/i,
  );
});

test("E2E fixtures accept only an explicitly confirmed, dedicated loopback database", () => {
  const url =
    "postgresql://postgres:synthetic@127.0.0.1:5432/visionquest_e2e_run_42";
  assert.equal(assertDisposableE2eDatabaseUrl(url, "true"), url);
});

