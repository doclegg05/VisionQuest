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
 * Human-friendly cohort-local rendering of an instant, e.g.
 * "Mon, Jun 29, 2:30 PM". Used when Sage speaks appointment times to students.
 */
export function formatCohortDateTime(
  value: Date | string,
  timeZone: string = COHORT_TIME_ZONE,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

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

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `"YYYY-MM-DD"` calendar day, one day later, expressed as {year, month}.
 * Plain UTC calendar arithmetic (no timezone math) — `zonedTimeToUtc` is what
 * turns the result into a real instant.
 */
function dayAfter(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * Report date-range bounds for a `"YYYY-MM-DD"`-only `from`/`to` pair
 * against a REAL TIMESTAMP column (plain Prisma `DateTime`, e.g.
 * `Connection.createdAt`, `Application.createdAt`) — an instant that
 * genuinely happened at some wall-clock moment, which is why it needs a
 * timezone at all.
 *
 * `from` becomes the ET-cohort START of that calendar day (inclusive);
 * `to` becomes the ET-cohort START of the day AFTER (exclusive) — so a
 * `createdAt >= from && createdAt < to` filter covers every instant of the
 * `to` calendar day in Eastern Time.
 *
 * This exists because `new Date("2026-06-30")` parses as UTC midnight, which
 * is 7-8pm ET on 2026-06-29 — a naive `to` bound silently drops the last
 * day's evening for this cohort (the same class of bug `monthBoundsInZone`
 * and `programYearBoundsUtc` already guard against at coarser granularity).
 *
 * Anything that is not exactly `YYYY-MM-DD` is passed to `new Date()`
 * unchanged — callers that already validated the query param with a
 * `YYYY-MM-DD` regex (every report route in this codebase does) never hit
 * that branch; it exists so a malformed value fails as "invalid date"
 * rather than silently vanishing here.
 *
 * NOT for a Prisma `@db.Date` column — see `dateOnlyBoundsUtc` below for
 * those; running one through THIS function shifts every row back one
 * calendar day, unconditionally, because ET is always behind UTC.
 */
export function reportDateRangeBoundsUtc(
  from?: string,
  to?: string,
  timeZone: string = COHORT_TIME_ZONE,
): { from?: Date; to?: Date } {
  let fromBound: Date | undefined;
  if (from) {
    const match = DATE_ONLY.exec(from);
    fromBound = match
      ? zonedTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0, timeZone)
      : new Date(from);
  }

  let toBound: Date | undefined;
  if (to) {
    const match = DATE_ONLY.exec(to);
    if (match) {
      const next = dayAfter(Number(match[1]), Number(match[2]), Number(match[3]));
      toBound = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
    } else {
      toBound = new Date(to);
    }
  }

  return { from: fromBound, to: toBound };
}

/**
 * Date-range bounds for a `"YYYY-MM-DD"`-only `from`/`to` pair against a
 * Prisma `@db.Date` column (e.g. `SpokesRecord.enrolledAt`) — a plain
 * calendar date with NO time-of-day, which Postgres/Prisma always returns
 * as an instant at exactly UTC midnight for that date. It is not "a moment
 * that could fall on either side of a timezone boundary" — it already IS
 * the date, with no timezone attached — so this function does PLAIN
 * `Date.UTC` arithmetic and never touches a timezone at all.
 *
 * `from` becomes UTC midnight of that calendar day (inclusive); `to`
 * becomes UTC midnight of the day AFTER (exclusive) — so
 * `enrolledAt >= from && enrolledAt < to` covers every `@db.Date` row dated
 * on or between `from` and `to` inclusive.
 *
 * A 2026-09 review first pointed dohs-export.ts's `@db.Date` filters at
 * `reportDateRangeBoundsUtc` (the ET-aware function above), which shifted
 * the WHOLE reporting window back one day: `enrolledAt >= "2026-06-01"`
 * became `>= 2026-06-01T04:00:00Z` (ET midnight), which excludes every row
 * literally dated `2026-06-01T00:00:00Z` (UTC midnight, what a `@db.Date`
 * row for that date actually stores) — the review's own earlier finding
 * about row-DISPLAY dates (`dohs-export-shared.ts`'s `toDateOnlyUtc`)
 * applies equally to row FILTERING and was missed here the first time.
 */
export function dateOnlyBoundsUtc(from?: string, to?: string): { from?: Date; to?: Date } {
  let fromBound: Date | undefined;
  if (from) {
    const match = DATE_ONLY.exec(from);
    fromBound = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      : new Date(from);
  }

  let toBound: Date | undefined;
  if (to) {
    const match = DATE_ONLY.exec(to);
    if (match) {
      const next = dayAfter(Number(match[1]), Number(match[2]), Number(match[3]));
      toBound = new Date(Date.UTC(next.year, next.month - 1, next.day));
    } else {
      toBound = new Date(to);
    }
  }

  return { from: fromBound, to: toBound };
}
