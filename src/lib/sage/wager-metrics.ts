import { prisma } from "@/lib/db";

export interface WagerStatusRow {
  status: string;
}

export interface WagerHitRate {
  open: number;
  won: number;
  lost: number;
  voided: number;
  hitRate: number;
}

export function computeWagerHitRate(rows: WagerStatusRow[]): WagerHitRate {
  const open = rows.filter((r) => r.status === "open").length;
  const won = rows.filter((r) => r.status === "won").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const voided = rows.filter((r) => r.status === "void").length;
  const settled = won + lost;
  return { open, won, lost, voided, hitRate: settled > 0 ? won / settled : 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getWagerHitRate(options: {
  wagerType: string;
  sinceDays?: number;
  studentId?: string;
}): Promise<WagerHitRate> {
  const where: { wagerType: string; studentId?: string; createdAt?: { gte: Date } } = {
    wagerType: options.wagerType,
  };
  if (options.studentId) where.studentId = options.studentId;
  if (options.sinceDays) {
    where.createdAt = { gte: new Date(Date.now() - options.sinceDays * DAY_MS) };
  }
  const rows = await prisma.wager.findMany({ where, select: { status: true } });
  return computeWagerHitRate(rows);
}
