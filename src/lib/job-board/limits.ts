import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export type JobSource = "jsearch" | "usajobs" | "adzuna";
export const JOB_SOURCES: JobSource[] = ["jsearch", "usajobs", "adzuna"];

interface QuotaReservationResult {
  allowed: boolean;
  reason?: string;
}

interface RateLimitSnapshot {
  count: number;
  resetTime: number | null;
}

export interface SourceUsageWindow {
  limit: number | null;
  used: number;
  remaining: number | null;
  resetTime: number | null;
}

export interface JobSourceUsageSummary {
  source: JobSource;
  daily: SourceUsageWindow;
  monthly: SourceUsageWindow;
}

export interface ManualRefreshStatus {
  cooldownMinutes: number;
  available: boolean;
  resetTime: number | null;
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

function getSourceLimitConfig(source: JobSource) {
  const prefix = getEnvPrefix(source);
  return {
    dailyLimit: parsePositiveInt(process.env[`${prefix}_MAX_REQUESTS_PER_DAY`]),
    monthlyLimit: parsePositiveInt(process.env[`${prefix}_MAX_REQUESTS_PER_MONTH`]),
  };
}

async function getRateLimitSnapshot(key: string): Promise<RateLimitSnapshot> {
  const entry = await prisma.rateLimitEntry.findUnique({
    where: { key },
    select: { count: true, resetTime: true },
  });

  if (!entry) {
    return { count: 0, resetTime: null };
  }

  if (entry.resetTime.getTime() <= Date.now()) {
    return { count: 0, resetTime: entry.resetTime.getTime() };
  }

  return { count: entry.count, resetTime: entry.resetTime.getTime() };
}

function toUsageWindow(limit: number | null, snapshot: RateLimitSnapshot): SourceUsageWindow {
  return {
    limit,
    used: snapshot.count,
    remaining: limit == null ? null : Math.max(limit - snapshot.count, 0),
    resetTime: snapshot.resetTime,
  };
}

export async function reserveSourceQuota(source: JobSource): Promise<QuotaReservationResult> {
  const now = new Date();
  const { dailyLimit, monthlyLimit } = getSourceLimitConfig(source);

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

export async function getSourceUsageSummary(source: JobSource): Promise<JobSourceUsageSummary> {
  const now = new Date();
  const { dailyLimit, monthlyLimit } = getSourceLimitConfig(source);

  const [dailySnapshot, monthlySnapshot] = await Promise.all([
    getRateLimitSnapshot(`job-scrape:${source}:day:${getUtcDayKey(now)}`),
    getRateLimitSnapshot(`job-scrape:${source}:month:${getUtcMonthKey(now)}`),
  ]);

  return {
    source,
    daily: toUsageWindow(dailyLimit, dailySnapshot),
    monthly: toUsageWindow(monthlyLimit, monthlySnapshot),
  };
}

export async function getAllSourceUsageSummaries(): Promise<JobSourceUsageSummary[]> {
  return Promise.all(JOB_SOURCES.map((source) => getSourceUsageSummary(source)));
}

export async function getManualRefreshStatus(classId: string): Promise<ManualRefreshStatus> {
  const cooldownMinutes = parsePositiveInt(process.env.JOB_SCRAPE_MANUAL_REFRESH_COOLDOWN_MINUTES) ?? 30;
  const snapshot = await getRateLimitSnapshot(`job-scrape:manual-refresh:${classId}`);

  return {
    cooldownMinutes,
    available: snapshot.count === 0,
    resetTime: snapshot.resetTime,
  };
}
