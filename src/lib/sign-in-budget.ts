import { refundRateLimit, type RateLimitResult } from "./rate-limit";

/**
 * The per-account sign-in budget: how many wrong passwords one account may
 * take in a window, and the key they are counted under.
 *
 * It lives here so every route that checks an account's password counts
 * against the same budget. Sign-in does, and so does the change-password
 * route, which asks for the current password: a wrong one there is a guess at
 * the same secret. With a key or a number of its own, each route would hand a
 * caller five more guesses. sign-in-budget.test.ts fails if another file
 * writes the key.
 */

/** One window for the sign-in limits. The failure messages name it in minutes. */
export const SIGN_IN_WINDOW_MINUTES = 15;
export const SIGN_IN_WINDOW_MS = SIGN_IN_WINDOW_MINUTES * 60 * 1000;

/**
 * FAILED password checks on one account per window, from any address. This is
 * the brute-force control. A right password gives its unit back, so a student
 * can sign in on every lab PC in turn. One unit comes back, never the wrong
 * tries before it, and a refused attempt keeps its unit whatever the password
 * was. An attempt holds its unit until it is answered, so wrong tries plus
 * attempts in flight can never pass 5.
 */
export const ACCOUNT_FAILED_SIGN_IN_LIMIT = 5;

/**
 * The limiter key for one account's budget. Keyed on the account id, so the
 * account's email and student-ID logins, and every route, share one count.
 */
export function accountSignInLimiterKey(accountId: string): string {
  return `login:user:${accountId}`;
}

/** One unit a limiter call took, kept so a right password can give it back. */
export interface TakenUnit {
  key: string;
  resetTime: number;
}

/** Null when the limiter failed open: a degraded limiter took no unit, so there is nothing to give back. */
export function takenUnit(key: string, result: RateLimitResult): TakenUnit | null {
  return result.degraded ? null : { key, resetTime: result.resetTime };
}

/**
 * Gives back the units a right password took, each in the window it was taken
 * from. Call this only once the response is certain to say the password was
 * right. A unit that came back on any other answer would let the caller read
 * "right password" off a count.
 */
export async function giveBack(units: readonly (TakenUnit | null)[]): Promise<void> {
  await Promise.all(units.map((unit) => (unit ? refundRateLimit(unit.key, unit.resetTime) : undefined)));
}
