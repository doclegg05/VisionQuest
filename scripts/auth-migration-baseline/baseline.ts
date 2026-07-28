import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPasswordWithStatus } from "../../src/lib/auth";
import { canManageAnyClass } from "../../src/lib/classroom";
import { signToken, verifyToken } from "../../src/lib/session-token";

export type BaselineDisposition = "BASELINE_SAFEGUARD" | "MIGRATION_GAP";
export type FreezeStatus = "PENDING" | "VERIFIED" | "MISMATCH";

interface BaselineScenario {
  id: string;
  requirement: string;
  label: string;
  fixture: Record<string, unknown>;
  expectedCurrent: string;
  requiredMigration: string;
}

interface BaselineFixtures {
  baselineVersion: number;
  description: string;
  syntheticJwtSecret: string;
  scenarios: BaselineScenario[];
}

interface FreezeManifest {
  version: number;
  algorithm: "sha256";
  paths: Record<string, string>;
}

export interface SourceContract {
  legacyPasswordRehash: boolean;
  googleProviderSubjectBinding: boolean;
  googleVerifiedEmailEnforcement: boolean;
  googleMfaHandoff: boolean;
  invitationRedemption: boolean;
  teacherCrossClassroomAccess: boolean;
  sessionVersionRevocation: boolean;
}

export interface BaselineResult extends BaselineScenario {
  actualCurrent: string;
  disposition: BaselineDisposition;
}

export interface FreezeVerification {
  status: FreezeStatus;
  paths: Array<{
    path: string;
    expected: string | null;
    actual: string;
    verified: boolean;
  }>;
}

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HARNESS_DIR, "../..");
const FIXTURES_PATH = path.join(HARNESS_DIR, "fixtures.json");
const FREEZE_MANIFEST_PATH = path.join(HARNESS_DIR, "freeze-manifest.json");

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

export function loadFixtures(): BaselineFixtures {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8")) as BaselineFixtures;
}

export function collectSourceContract(): SourceContract {
  const authSource = readProjectFile("src/lib/auth.ts");
  const loginSource = readProjectFile("src/app/api/auth/login/route.ts");
  const callbackSource = readProjectFile("src/app/api/auth/google/callback/route.ts");
  const schemaSource = readProjectFile("prisma/schema.prisma");

  const providerSubjectVocabulary =
    /\b(providerSubject|providerSub|googleSubject|googleSub|openidSubject|oidcSubject)\b/;
  const invitationModel = /model\s+\w*(?:Invitation|Invite)\w*\s*\{/;

  return {
    legacyPasswordRehash:
      authSource.includes("Legacy PBKDF2") &&
      loginSource.includes("if (needsRehash && student)"),
    googleProviderSubjectBinding:
      providerSubjectVocabulary.test(schemaSource) &&
      providerSubjectVocabulary.test(callbackSource),
    googleVerifiedEmailEnforcement:
      /\bemail_verified\b/.test(callbackSource) ||
      /\bemailVerified\b/.test(callbackSource),
    googleMfaHandoff:
      callbackSource.includes("mfaEnabled") &&
      (callbackSource.includes("signMfaSessionToken") ||
        callbackSource.includes("setMfaSessionCookie")),
    invitationRedemption: invitationModel.test(schemaSource),
    teacherCrossClassroomAccess: canManageAnyClass("teacher"),
    sessionVersionRevocation:
      authSource.includes("student.sessionVersion !== claims.sv"),
  };
}

function scenarioById(fixtures: BaselineFixtures, id: string): BaselineScenario {
  const scenario = fixtures.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing baseline scenario: ${id}`);
  return scenario;
}

function evaluateLegacy(scenario: BaselineScenario): string {
  const password = String(scenario.fixture.password);
  const storedHash = String(scenario.fixture.storedHash);
  const result = verifyPasswordWithStatus(password, storedHash);
  return result.valid && result.needsRehash
    ? "PASSWORD_ACCEPTED_REHASH_REQUIRED"
    : "PASSWORD_REJECTED_OR_NOT_MIGRATED";
}

function evaluateSessionRevocation(
  scenario: BaselineScenario,
  syntheticJwtSecret: string,
): string {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = syntheticJwtSecret;

  try {
    const token = signToken(
      String(scenario.fixture.userId),
      String(scenario.fixture.role),
      Number(scenario.fixture.tokenSessionVersion),
    );
    const claims = verifyToken(token);
    if (!claims) return "TOKEN_REJECTED";
    return claims.sv === Number(scenario.fixture.accountSessionVersion)
      ? "SESSION_ACCEPTED"
      : "SESSION_REVOKED";
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
}

export function evaluateBaseline(): {
  fixtures: BaselineFixtures;
  source: SourceContract;
  results: BaselineResult[];
} {
  const fixtures = loadFixtures();
  const source = collectSourceContract();

  const actualById: Record<string, string> = {
    "AUTH-LEGACY-001": evaluateLegacy(
      scenarioById(fixtures, "AUTH-LEGACY-001"),
    ),
    "AUTH-GOOGLE-001": source.googleProviderSubjectBinding
      ? "BIND_EXISTING_ACCOUNT_BY_SUBJECT"
      : "CREATE_NEW_ACCOUNT_BY_EMAIL",
    "AUTH-GOOGLE-002": source.googleVerifiedEmailEnforcement
      ? "DENY_UNVERIFIED_EMAIL"
      : "SESSION_ISSUED",
    "AUTH-MFA-001": source.googleMfaHandoff
      ? "MFA_REQUIRED"
      : "SESSION_ISSUED",
    "AUTH-MFA-002": source.googleMfaHandoff
      ? "MFA_REQUIRED"
      : "SESSION_ISSUED",
    "AUTH-INVITE-001": source.invitationRedemption
      ? "REDEEM_AND_ENROLL"
      : "UNSUPPORTED",
    "AUTH-SCOPE-001": source.teacherCrossClassroomAccess
      ? "ALLOW_CROSS_CLASSROOM"
      : "DENY_CROSS_CLASSROOM",
    "AUTH-SESSION-001": evaluateSessionRevocation(
      scenarioById(fixtures, "AUTH-SESSION-001"),
      fixtures.syntheticJwtSecret,
    ),
  };

  const results = fixtures.scenarios.map((scenario) => {
    const actualCurrent = actualById[scenario.id];
    if (!actualCurrent) {
      throw new Error(`No evaluator for baseline scenario: ${scenario.id}`);
    }
    if (actualCurrent !== scenario.expectedCurrent) {
      throw new Error(
        `${scenario.id} drifted: expected current=${scenario.expectedCurrent}, actual=${actualCurrent}`,
      );
    }
    const disposition: BaselineDisposition =
      actualCurrent === scenario.requiredMigration
        ? "BASELINE_SAFEGUARD"
        : "MIGRATION_GAP";
    return {
      ...scenario,
      actualCurrent,
      disposition,
    };
  });

  return { fixtures, source, results };
}

function sha256(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function verifyFreezeManifest(): FreezeVerification {
  if (!fs.existsSync(FREEZE_MANIFEST_PATH)) {
    const pendingPath = path
      .relative(PROJECT_ROOT, FIXTURES_PATH)
      .replaceAll("\\", "/");
    return {
      status: "PENDING",
      paths: [
        {
          path: pendingPath,
          expected: null,
          actual: sha256(FIXTURES_PATH),
          verified: false,
        },
      ],
    };
  }

  const manifest = JSON.parse(
    fs.readFileSync(FREEZE_MANIFEST_PATH, "utf8"),
  ) as FreezeManifest;
  const paths = Object.entries(manifest.paths)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, expected]) => {
      const actual = sha256(path.join(PROJECT_ROOT, relativePath));
      return {
        path: relativePath,
        expected,
        actual,
        verified: actual === expected,
      };
    });

  return {
    status: paths.every((entry) => entry.verified)
      ? "VERIFIED"
      : "MISMATCH",
    paths,
  };
}
