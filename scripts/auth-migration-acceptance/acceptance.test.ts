import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMigrationAcceptance } from "./adapter";

test("the historical baseline files remain frozen", () => {
  assert.equal(evaluateMigrationAcceptance().freezeStatus.status, "VERIFIED");
});

test("all frozen migration scenarios now meet their required outcomes", () => {
  const { results } = evaluateMigrationAcceptance();
  assert.equal(results.length, 8);
  for (const result of results) {
    assert.equal(
      result.passed,
      true,
      `${result.id}: expected ${result.expected}, received ${result.actual}`,
    );
  }
});

test("Better Auth storage, passkeys, and the legacy login coexist", () => {
  assert.deepEqual(evaluateMigrationAcceptance().capabilities, {
    prismaBackedAccounts: true,
    prismaBackedSessions: true,
    passkeys: true,
    legacyLoginPreserved: true,
    legacyGoogleStaffMfaEnforced: true,
  });
});
