import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import type { ProviderQuotaSnapshot } from "./types";

export type JobSource = "jsearch" | "usajobs" | "adzuna" | "careeronestop";
export const JOB_SOURCES: JobSource[] = ["jsearch", "usajobs", "adzuna", "careeronestop"];

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
  provider: ProviderQuotaWindow[];
}

export interface ManualRefreshStatus {
  cooldownMinutes: number;
  available: boolean;
  resetTime: number | null;
}

export interface ProviderQuotaWindow {
  id: string;
  label: string;
  limit: number;
  used: number;
  remaining: number;
  resetTime: number | null;
  updatedAt: number | null;
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

function getProviderQuotaKey(source: JobSource, snapshotId: string, field: "limit" | "remaining") {
  return `job-provider-quota:${source}:${snapshotId}:${field}`;
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

async function getStoredProviderQuotaWindows(source: JobSource): Promise<ProviderQuotaWindow[]> {
  const entries = await prisma.rateLimitEntry.findMany({
    where: {
      key: {
        startsWith: `job-provider-quota:${source}:`,
      },
    },
    select: {
      key: true,
      count: true,
      resetTime: true,
      updatedAt: true,
    },
  });

  const grouped = new Map<
    string,
    {
      label: string;
      limit?: typeof entries[number];
      remaining?: typeof entries[number];
    }
  >();

  for (const entry of entries) {
    const [, , , snapshotId, field] = entry.key.split(":");
    if (!snapshotId || (field !== "limit" && field !== "remaining")) {
      continue;
    }

    const existing = grouped.get(snapshotId) ?? {
      label: snapshotId
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    };
    existing[field] = entry;
    grouped.set(snapshotId, existing);
  }

  const windows = Array.from(grouped.entries())
    .map<ProviderQuotaWindow | null>(([id, value]) => {
      if (!value.limit || !value.remaining) {
        return null;
      }

      const used = Math.max(value.limit.count - value.remaining.count, 0);
      return {
        id,
        label: value.label,
        limit: value.limit.count,
        remaining: value.remaining.count,
        used,
        resetTime: value.remaining.resetTime.getTime(),
        updatedAt: Math.max(value.limit.updatedAt.getTime(), value.remaining.updatedAt.getTime()),
      };
    })
    .filter((value): value is ProviderQuotaWindow => value !== null);

  return windows.sort((a, b) => a.label.localeCompare(b.label));
}

function parseQuotaNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseResetHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function readQuotaWindow(
  headers: Headers,
  {
    id,
    label,
    limitHeader,
    remainingHeader,
    resetHeader,
  }: {
    id: string;
    label: string;
    limitHeader: string;
    remainingHeader: string;
    resetHeader: string;
  },
): ProviderQuotaSnapshot | null {
  const limit = parseQuotaNumber(headers.get(limitHeader));
  const remaining = parseQuotaNumber(headers.get(remainingHeader));

  if (limit == null || remaining == null) {
    return null;
  }

  return {
    id,
    label,
    limit,
    remaining,
    resetTime: parseResetHeader(headers.get(resetHeader)),
  };
}

export function extractProviderQuotaSnapshots(source: JobSource, headers: Headers): ProviderQuotaSnapshot[] {
  const windows: Array<ProviderQuotaSnapshot | null> = [
    readQuotaWindow(headers, {
      id: "requests",
      label: "Provider quota",
      limitHeader: "x-ratelimit-requests-limit",
      remainingHeader: "x-ratelimit-requests-remaining",
      resetHeader: "x-ratelimit-requests-reset",
    }),
    readQuotaWindow(headers, {
      id: "burst",
      label: "Burst rate limit",
      limitHeader: "x-ratelimit-limit",
      remainingHeader: "x-ratelimit-remaining",
      resetHeader: "x-ratelimit-reset",
    }),
  ];

  if (source === "jsearch") {
    windows.push(
      readQuotaWindow(headers, {
        id: "rapid-free-plan",
        label: "RapidAPI free-plan quota",
        limitHeader: "x-rate-limit-requests-limit",
        remainingHeader: "x-rate-limit-requests-remaining",
        resetHeader: "x-rate-limit-requests-reset",
      }),
    );
  }

  const deduped = new Map<string, ProviderQuotaSnapshot>();
  for (const snapshot of windows) {
    if (!snapshot) continue;
    deduped.set(snapshot.id, snapshot);
  }

  return Array.from(deduped.values());
}

export async function recordProviderQuotaSnapshots(
  source: JobSource,
  snapshots: ProviderQuotaSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  const now = new Date();

  await prisma.$transaction(
    snapshots.flatMap((snapshot) => {
      const resetTime = snapshot.resetTime ? new Date(snapshot.resetTime) : now;

      return [
        prisma.rateLimitEntry.upsert({
          where: { key: getProviderQuotaKey(source, snapshot.id, "limit") },
          update: { count: snapshot.limit, resetTime },
          create: {
            key: getProviderQuotaKey(source, snapshot.id, "limit"),
            count: snapshot.limit,
            resetTime,
          },
        }),
        prisma.rateLimitEntry.upsert({
          where: { key: getProviderQuotaKey(source, snapshot.id, "remaining") },
          update: { count: snapshot.remaining, resetTime },
          create: {
            key: getProviderQuotaKey(source, snapshot.id, "remaining"),
            count: snapshot.remaining,
            resetTime,
          },
        }),
      ];
    }),
  );
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
  const providerWindows = await getStoredProviderQuotaWindows(source);

  const exhaustedProviderWindow = providerWindows.find((window) => {
    if (window.remaining > 0) return false;
    if (window.resetTime == null) return true;
    return window.resetTime > now.getTime();
  });

  if (exhaustedProviderWindow) {
    return {
      allowed: false,
      reason: `${source} provider quota reached (${exhaustedProviderWindow.label.toLowerCase()})`,
    };
  }

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

  const [dailySnapshot, monthlySnapshot, providerWindows] = await Promise.all([
    getRateLimitSnapshot(`job-scrape:${source}:day:${getUtcDayKey(now)}`),
    getRateLimitSnapshot(`job-scrape:${source}:month:${getUtcMonthKey(now)}`),
    getStoredProviderQuotaWindows(source),
  ]);

  return {
    source,
    daily: toUsageWindow(dailyLimit, dailySnapshot),
    monthly: toUsageWindow(monthlyLimit, monthlySnapshot),
    provider: providerWindows,
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
