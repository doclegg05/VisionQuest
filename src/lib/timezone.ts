// ---------------------------------------------------------------------------
// Cohort time-zone helpers
//
// WV SPOKES runs on Eastern Time. Grant reporting periods — monthly buckets and
// the July 1–June 30 program year — must be derived from ET wall-clock
// boundaries, NOT UTC. Computing bounds in UTC pushes month/year-end events
// (e.g. an enrollment at 9pm ET on the last day of the month = 1am UTC the next
// day) into the wrong reporting period for the ET cohort.
//
// Dependency-free (uses Intl) so it works in the standalone server bundle.
// ---------------------------------------------------------------------------

/** WV is Eastern Time; America/New_York carries the correct EST/EDT rules. */
export const COHORT_TIME_ZONE = "America/New_York";

/**
 * Minutes the zone is offset from UTC at a given instant (negative for ET,
 * which is behind UTC: -240 during EDT, -300 during EST).
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some ICU builds emit "24" for midnight
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((wallAsUtc - instant.getTime()) / 60000);
}

/**
 * The UTC instant corresponding to a wall-clock time in `timeZone`.
 * Month/year boundaries (midnight on the 1st) never coincide with a DST
 * transition (2am on specific Sundays), so the single-offset adjustment is
 * exact for our use.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = COHORT_TIME_ZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = zoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}

/** Calendar year/month (1-12) of an instant as read in `timeZone`. */
function zoneYearMonth(instant: Date, timeZone: string): { year: number; month: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" });
  const parts = dtf.formatToParts(instant);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  };
}

/**
 * Start (inclusive) and end (exclusive) UTC instants of the ET calendar month
 * containing `reference`.
 */
export function monthBoundsInZone(
  reference: Date = new Date(),
  timeZone: string = COHORT_TIME_ZONE,
): { start: Date; end: Date } {
  const { year, month } = zoneYearMonth(reference, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: zonedTimeToUtc(year, month, 1, 0, 0, 0, timeZone),
    end: zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, 0, timeZone),
  };
}

/**
 * WV SPOKES program year (July 1–June 30) for `reference`, labeled by its
 * ending year: July–Dec → next year, Jan–June → current year.
 * PY2026 = July 1 2025 – June 30 2026.
 */
export function programYearNumber(
  reference: Date = new Date(),
  timeZone: string = COHORT_TIME_ZONE,
): number {
  const { year, month } = zoneYearMonth(reference, timeZone);
  return month >= 7 ? year + 1 : year;
}

/**
 * Start (inclusive) and end (exclusive) UTC instants of program year `pyNum`,
 * with boundaries anchored to ET midnight on July 1.
 */
export function programYearBoundsUtc(
  pyNum: number,
  timeZone: string = COHORT_TIME_ZONE,
): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(pyNum - 1, 7, 1, 0, 0, 0, timeZone),
    end: zonedTimeToUtc(pyNum, 7, 1, 0, 0, 0, timeZone),
  };
}
