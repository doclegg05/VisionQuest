import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSourceContract,
  evaluateBaseline,
  loadFixtures,
  verifyFreezeManifest,
} from "./baseline";

const EXPECTED_IDS = [
  "AUTH-LEGACY-001",
  "AUTH-GOOGLE-001",
  "AUTH-GOOGLE-002",
  "AUTH-MFA-001",
  "AUTH-MFA-002",
  "AUTH-INVITE-001",
  "AUTH-SCOPE-001",
  "AUTH-SESSION-001",
];

test("frozen fixture inventory covers every Goal 0 migration requirement", () => {
  const fixtures = loadFixtures();
  assert.deepEqual(
    fixtures.scenarios.map((scenario) => scenario.id),
    EXPECTED_IDS,
  );
  assert.equal(fixtures.baselineVersion, 2);
});

test("legacy PBKDF2 fixture is accepted and requires scrypt migration", () => {
  const result = evaluateBaseline().results.find(
    (scenario) => scenario.id === "AUTH-LEGACY-001",
  );
  assert.equal(result?.actualCurrent, "PASSWORD_ACCEPTED_REHASH_REQUIRED");
  assert.equal(result?.disposition, "BASELINE_SAFEGUARD");
});

test("Google baseline exposes subject-binding and verified-email gaps", () => {
  const { source, results } = evaluateBaseline();
  assert.equal(source.googleProviderSubjectBinding, false);
  assert.equal(source.googleVerifiedEmailEnforcement, false);
  assert.equal(
    results.find((scenario) => scenario.id === "AUTH-GOOGLE-001")
      ?.disposition,
    "MIGRATION_GAP",
  );
  assert.equal(
    results.find((scenario) => scenario.id === "AUTH-GOOGLE-002")
      ?.disposition,
    "MIGRATION_GAP",
  );
});

test("Google baseline exposes MFA handoff gaps for instructor and developer-admin", () => {
  const { source, results } = evaluateBaseline();
  assert.equal(source.googleMfaHandoff, false);
  for (const id of ["AUTH-MFA-001", "AUTH-MFA-002"]) {
    const scenario = results.find((candidate) => candidate.id === id);
    assert.equal(scenario?.actualCurrent, "SESSION_ISSUED");
    assert.equal(scenario?.disposition, "MIGRATION_GAP");
  }
});

test("invitation redemption is explicitly unsupported in the current schema", () => {
  const { source, results } = evaluateBaseline();
  assert.equal(source.invitationRedemption, false);
  const scenario = results.find(
    (candidate) => candidate.id === "AUTH-INVITE-001",
  );
  assert.equal(scenario?.actualCurrent, "UNSUPPORTED");
  assert.equal(scenario?.disposition, "MIGRATION_GAP");
});

test("cross-classroom instructor denial is not a current application-layer invariant", () => {
  const { source, results } = evaluateBaseline();
  assert.equal(source.teacherCrossClassroomAccess, true);
  const scenario = results.find(
    (candidate) => candidate.id === "AUTH-SCOPE-001",
  );
  assert.equal(scenario?.actualCurrent, "ALLOW_CROSS_CLASSROOM");
  assert.equal(scenario?.disposition, "MIGRATION_GAP");
});

test("sessionVersion increment revokes the synthetic session", () => {
  const { source, results } = evaluateBaseline();
  assert.equal(source.sessionVersionRevocation, true);
  const scenario = results.find(
    (candidate) => candidate.id === "AUTH-SESSION-001",
  );
  assert.equal(scenario?.actualCurrent, "SESSION_REVOKED");
  assert.equal(scenario?.disposition, "BASELINE_SAFEGUARD");
});

test("source contract remains pinned to the observed pre-migration behavior", () => {
  assert.deepEqual(collectSourceContract(), {
    legacyPasswordRehash: true,
    googleProviderSubjectBinding: false,
    googleVerifiedEmailEnforcement: false,
    googleMfaHandoff: false,
    invitationRedemption: false,
    teacherCrossClassroomAccess: true,
    sessionVersionRevocation: true,
  });
});

test("freeze manifest is either pending initial capture or fully verified", () => {
  const freeze = verifyFreezeManifest();
  assert.notEqual(freeze.status, "MISMATCH");
});
