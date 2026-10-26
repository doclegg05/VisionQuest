import { logger } from "@/lib/logger";

/**
 * Cohort demo mode: the marker, the switch and the limits.
 *
 * `src/proxy.ts` imports this file, so it must stay free of Prisma and of
 * anything else that is heavy or server-only. The marker values below mirror
 * the `DemoAccountKind` enum in prisma/schema.prisma; config.test.ts compares
 * the two so they cannot drift apart.
 */

/** The two kinds of demo account. NULL on a Student row means a real person. */
export const DEMO_ACCOUNT_KINDS = ["student", "instructor"] as const;
export type DemoAccountKind = (typeof DEMO_ACCOUNT_KINDS)[number];

/** The one shared demo instructor and the one demo class they teach. */
export const DEMO_INSTRUCTOR_LOGIN = "demo-instructor";
export const DEMO_INSTRUCTOR_NAME = "Demo Instructor";
export const DEMO_CLASS_CODE = "cohort-demo";
export const DEMO_CLASS_NAME = "Cohort Demo Class";

/**
 * Login ids for demo students. A visitor gets `demo-` plus 12 hex characters;
 * the four starter students use the longer `demo-starter-` prefix, which sits
 * inside the shorter one, so a `demo-` prefix match covers both.
 */
export const DEMO_STUDENT_LOGIN_PREFIX = "demo-";
export const DEMO_STARTER_LOGIN_PREFIX = "demo-starter-";

const SWITCH_VARIABLE = "COHORT_DEMO_MODE";

/**
 * Where the switch and limits are read from. `process.env` fits, and so does a
 * plain object in a test. `NodeJS.ProcessEnv` itself would not: Next's typings
 * make `NODE_ENV` required on it, so a test could not pass a literal.
 */
type DemoEnv = Readonly<Record<string, string | undefined>>;

/**
 * Demo mode is on only when the switch, trimmed and lowercased, is `true`.
 * Anything else, including a missing variable, leaves it off.
 */
export function isCohortDemoEnabled(env: DemoEnv = process.env): boolean {
  return env[SWITCH_VARIABLE]?.trim().toLowerCase() === "true";
}

export interface DemoLimits {
  /** New demo students one network may start in an hour. */
  perNetworkHourly: number;
  /** New demo students, site-wide, per hour. */
  siteHourly: number;
  /** New demo students, site-wide, per UTC day. */
  siteDaily: number;
  /** Sage messages across every demo account, per UTC day. */
  sageDaily: number;
  /** Sage messages the shared demo instructor may send, per hour. */
  instructorSageHourly: number;
  /** Sage messages the shared demo instructor may send, per UTC day. */
  instructorSageDaily: number;
}

const DEFAULT_LIMITS: DemoLimits = {
  perNetworkHourly: 10,
  siteHourly: 40,
  siteDaily: 200,
  sageDaily: 2000,
  instructorSageHourly: 300,
  instructorSageDaily: 1000,
};

/** The three limits an operator may change from the Render dashboard. */
const LIMIT_OVERRIDES = [
  { variable: "COHORT_DEMO_STUDENTS_PER_HOUR", limit: "siteHourly" },
  { variable: "COHORT_DEMO_STUDENTS_PER_DAY", limit: "siteDaily" },
  { variable: "COHORT_DEMO_SAGE_PER_DAY", limit: "sageDaily" },
] as const satisfies ReadonlyArray<{ variable: string; limit: keyof DemoLimits }>;

/**
 * Reads one override as a whole number of at least 1. A missing or blank
 * variable is a quiet fallback. Any other value that is not such a number
 * (letters, a decimal, zero, a negative, a suffix, a number too big to count
 * exactly) falls back too and logs one warning that names the variable. The
 * value itself is not logged. This never throws: a typo in a dashboard field
 * must not take the sign-in page down.
 */
function readLimit(env: DemoEnv, variable: string, fallback: number): number {
  const raw = env[variable]?.trim();
  if (!raw) return fallback;

  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;

  logger.warn("Ignoring an invalid cohort demo limit; using the default", { variable });
  return fallback;
}

/** The demo limits: the spec defaults, with any valid environment override applied. */
export function getDemoLimits(env: DemoEnv = process.env): DemoLimits {
  const overrides = Object.fromEntries(
    LIMIT_OVERRIDES.map(({ variable, limit }) => [limit, readLimit(env, variable, DEFAULT_LIMITS[limit])]),
  );
  return { ...DEFAULT_LIMITS, ...overrides };
}
