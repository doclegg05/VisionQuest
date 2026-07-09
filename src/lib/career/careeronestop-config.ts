/**
 * Shared CareerOneStop Web API configuration — single source of truth for the
 * job-search adapter (src/lib/job-board/adapters/careeronestop.ts) and the
 * counseling client (./careeronestop-counseling.ts).
 *
 * Env keys (names only — values must never be logged, echoed, or bundled
 * client-side): COS_USER_ID (path segment), COS_API_TOKEN (bearer token).
 */

export const COS_API_BASE = "https://api.careeronestop.org";

export interface CareerOneStopCredentials {
  userId: string;
  token: string;
}

/**
 * Read credentials at call time — never at import — so unconfigured
 * deployments load this module without side effects and tests can toggle env.
 */
export function careerOneStopCredentials(): CareerOneStopCredentials | null {
  const userId = process.env.COS_USER_ID;
  const token = process.env.COS_API_TOKEN;
  if (!userId || !token) return null;
  return { userId, token };
}

export function isCareerOneStopConfigured(): boolean {
  return careerOneStopCredentials() !== null;
}
