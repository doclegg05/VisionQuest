import { rateLimit } from "@/lib/rate-limit";

type JobSource = "jsearch" | "usajobs" | "adzuna";

interface QuotaReservationResult {
  allowed: boolean;
  reason?: string;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getEnvPrefix(source: JobSource) {
  return source.toUpperCase();
}

function getUtcDayKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

function getUtcMonthKey(now: Date) {
  return now.toISOString().slice(0, 7);
}

function msUntilNextUtcDay(now: Date) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(next - now.getTime(), 1000);
}

function msUntilNextUtcMonth(now: Date) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  );
  return Math.max(next - now.getTime(), 1000);
}

export async function reserveSourceQuota(source: JobSource): Promise<QuotaReservationResult> {
  const prefix = getEnvPrefix(source);
  const now = new Date();
  const dailyLimit = parsePositiveInt(process.env[`${prefix}_MAX_REQUESTS_PER_DAY`]);
  const monthlyLimit = parsePositiveInt(process.env[`${prefix}_MAX_REQUESTS_PER_MONTH`]);

  if (dailyLimit) {
    const dayResult = await rateLimit(
      `job-scrape:${source}:day:${getUtcDayKey(now)}`,
      dailyLimit,
      msUntilNextUtcDay(now),
    );
    if (!dayResult.success) {
      return { allowed: false, reason: `${source} daily quota reached` };
    }
  }

  if (monthlyLimit) {
    const monthResult = await rateLimit(
      `job-scrape:${source}:month:${getUtcMonthKey(now)}`,
      monthlyLimit,
      msUntilNextUtcMonth(now),
    );
    if (!monthResult.success) {
      return { allowed: false, reason: `${source} monthly quota reached` };
    }
  }

  return { allowed: true };
}

export async function enforceManualRefreshCooldown(classId: string) {
  const cooldownMinutes = parsePositiveInt(process.env.JOB_SCRAPE_MANUAL_REFRESH_COOLDOWN_MINUTES) ?? 30;
  const result = await rateLimit(
    `job-scrape:manual-refresh:${classId}`,
    1,
    cooldownMinutes * 60 * 1000,
  );

  return {
    allowed: result.success,
    cooldownMinutes,
    resetTime: result.resetTime,
  };
}
