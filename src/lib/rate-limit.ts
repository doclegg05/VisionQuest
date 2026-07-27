import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "./db";

const MAX_RETRIES = 3;

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const now = new Date();
    const nextReset = new Date(now.getTime() + windowMs);

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.rateLimitEntry.findUnique({ where: { key } });

        if (!existing || existing.resetTime <= now) {
          await tx.rateLimitEntry.upsert({
            where: { key },
            update: { count: 1, resetTime: nextReset },
            create: { key, count: 1, resetTime: nextReset },
          });

          return {
            success: true,
            remaining: Math.max(limit - 1, 0),
            resetTime: nextReset.getTime(),
          };
        }

        if (existing.count >= limit) {
          return {
            success: false,
            remaining: 0,
            resetTime: existing.resetTime.getTime(),
          };
        }

        const updated = await tx.rateLimitEntry.update({
          where: { key },
          data: { count: { increment: 1 } },
        });

        return {
          success: true,
          remaining: Math.max(limit - updated.count, 0),
          resetTime: existing.resetTime.getTime(),
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to apply rate limit after retries.");
}

/**
 * Read-only view of a rate-limit key: reports whether one more unit would be
 * allowed WITHOUT consuming anything. Used by two-leg flows (propose →
 * confirm) where the unit is consumed only when the confirmed action actually
 * runs (VQ-R-012).
 */
export async function peekRateLimit(key: string, limit: number): Promise<RateLimitResult> {
  const now = new Date();
  const existing = await prisma.rateLimitEntry.findUnique({ where: { key } });

  if (!existing || existing.resetTime <= now) {
    return { success: true, remaining: limit, resetTime: existing?.resetTime.getTime() ?? 0 };
  }

  return {
    success: existing.count < limit,
    remaining: Math.max(limit - existing.count, 0),
    resetTime: existing.resetTime.getTime(),
  };
}

/**
 * Daily rate limit with calendar-day window (resets at midnight UTC).
 * Returns the same RateLimitResult shape as rateLimit().
 */
export async function rateLimitDaily(
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const windowMs = tomorrow.getTime() - now.getTime();

  return rateLimit(key, limit, windowMs);
}
