/**
 * Parses raw salary text into a normalized hourly rate (float).
 *
 * Examples:
 *   "$14.50/hr"          → 14.50
 *   "$30,000/year"       → 14.42  (30000 / 2080)
 *   "$400 - $800 a week" → 10     (400 / 40)
 *   "$15-$18/hr"         → 15     (take minimum)
 *   "Competitive"        → null
 *
 * Sources state pay in whatever period they like — jsearch passes through
 * JSearch's `job_salary_period` (hour/day/week/month/year), while remotive and
 * the ATS adapters pass free text. Periods are detected explicitly; only when
 * no unit is stated at all does the amount's magnitude decide.
 */

const HOURS_PER_YEAR = 2080;

export type PayPeriod = "hourly" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

/** Working hours per pay period, used to normalize any period to hourly. */
export const PERIOD_HOURS: Record<PayPeriod, number> = {
  hourly: 1,
  daily: 8,
  weekly: 40,
  biweekly: 80,
  monthly: HOURS_PER_YEAR / 12,
  yearly: HOURS_PER_YEAR,
};

/**
 * Bounds on a normalized rate. A converted value outside this band means the
 * source mislabeled the period (Indeed tags per-visit nurse pay as "hourly")
 * or the text was never a wage. Dropping it beats feeding a bogus number into
 * the min-pay filter and match scoring.
 */
export const MIN_PLAUSIBLE_HOURLY = 2;
export const MAX_PLAUSIBLE_HOURLY = 200;

/**
 * Ordered longest-signal-first: `biweekly` must be tested before `weekly`,
 * since "bi-weekly" would otherwise match the weekly pattern.
 */
const PERIOD_PATTERNS: ReadonlyArray<readonly [PayPeriod, RegExp]> = [
  ["biweekly", /\bbi[\s-]?weekly\b|\bevery two weeks\b|\bfortnight/],
  ["hourly", /\bhourly\b|(?:\/|\bper\s+|\ban?\s+)(?:hour|hr)s?\b/],
  ["daily", /\bdaily\b|(?:\/|\bper\s+|\ba\s+)days?\b/],
  ["weekly", /\bweekly\b|(?:\/|\bper\s+|\ba\s+)(?:week|wk)s?\b/],
  ["monthly", /\bmonthly\b|(?:\/|\bper\s+|\ba\s+)(?:month|mo)s?\b/],
  ["yearly", /\byearly\b|\bannual(?:ly)?\b|(?:\/|\bper\s+|\ba\s+)(?:year|yr|annum)s?\b/],
];

/** Unit words a stated period may legitimately use. */
const KNOWN_UNIT_WORDS = new Set([
  "hour", "hours", "hr", "hrs", "hourly",
  "day", "days", "daily",
  "week", "weeks", "wk", "wks", "weekly", "biweekly",
  "month", "months", "mo", "mos", "monthly",
  "year", "years", "yr", "yrs", "annum", "annual", "annually", "yearly",
  "fortnight",
]);

/**
 * A unit stated with a strong marker — "/x" or "per x". Bare "a x" is too
 * common in ordinary prose to treat as a unit claim.
 */
const EXPLICIT_UNIT = /(?:\/|\bper\s+)\s*([a-z]+)/;

/** Amounts above this, with no stated period, are assumed to be annual. */
const BARE_ANNUAL_THRESHOLD = 1000;

/**
 * Converts an amount in a known pay period to an hourly rate, or null if the
 * period is unknown, the amount unusable, or the result implausible.
 */
export function hourlyFromAmount(
  amount: number | null | undefined,
  period: string | null | undefined,
): number | null {
  if (!period) return null;

  const hoursPerPeriod = PERIOD_HOURS[period.toLowerCase() as PayPeriod];
  if (!hoursPerPeriod) return null;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;

  const hourly = Math.round((amount / hoursPerPeriod) * 100) / 100;
  if (hourly < MIN_PLAUSIBLE_HOURLY || hourly > MAX_PLAUSIBLE_HOURLY) return null;

  return hourly;
}

function detectPeriod(text: string): PayPeriod | null {
  for (const [period, pattern] of PERIOD_PATTERNS) {
    if (pattern.test(text)) return period;
  }
  return null;
}

export function parseSalaryToHourly(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const text = raw.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();

  const amounts = [...text.matchAll(/\$?(\d+(?:\.\d+)?)/g)]
    .map((match) => parseFloat(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (amounts.length === 0) return null;

  // The floor of a range is the conservative figure to filter and score on.
  const amount = amounts[0];

  const period = detectPeriod(text);
  if (period) return hourlyFromAmount(amount, period);

  // A unit was stated but is not a pay period ("per point", "/visit"). That is
  // an unknown, not an hourly rate.
  const statedUnit = text.match(EXPLICIT_UNIT)?.[1];
  if (statedUnit && !KNOWN_UNIT_WORDS.has(statedUnit)) return null;

  // No period stated at all — remotive and the ATS adapters pass free text
  // like "$50000" or "$18-$22". Fall back to magnitude.
  return hourlyFromAmount(amount, amount > BARE_ANNUAL_THRESHOLD ? "yearly" : "hourly");
}
