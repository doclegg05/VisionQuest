import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { checkTokenQuota } from "@/lib/llm-usage";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DailyUsageRow {
  date: string;
  total_tokens: bigint;
  input_tokens: bigint;
  output_tokens: bigint;
  call_count: bigint;
}

function serializeDailyRow(row: DailyUsageRow) {
  return {
    date: row.date,
    totalTokens: Number(row.total_tokens),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    callCount: Number(row.call_count),
  };
}

// ─── GET /api/teacher/students/[id]/usage ───────────────────────────────────

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: studentId } = await params;
  const student = await assertStaffCanManageStudent(session, studentId);

  const now = new Date();

  // Start of today (local server time)
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // 7 days ago
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // 30 days ago
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // Run quota check and daily breakdown in parallel
  const [quotaStatus, dailyUsage] = await Promise.all([
    checkTokenQuota(studentId, student.role),
    prisma.$queryRaw<DailyUsageRow[]>(Prisma.sql`
      SELECT
        TO_CHAR(DATE("createdAt"), 'YYYY-MM-DD') AS date,
        COALESCE(SUM("totalTokens"), 0) AS total_tokens,
        COALESCE(SUM("inputTokens"), 0) AS input_tokens,
        COALESCE(SUM("outputTokens"), 0) AS output_tokens,
        COUNT(*)::bigint AS call_count
      FROM "visionquest"."LlmCallLog"
      WHERE "studentId" = ${studentId}
        AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY DATE("createdAt") DESC
    `),
  ]);

  // Split daily breakdown into time ranges
  const todayStr = startOfToday.toISOString().slice(0, 10);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const today = dailyUsage
    .filter((row) => row.date === todayStr)
    .map(serializeDailyRow);

  const last7Days = dailyUsage
    .filter((row) => row.date >= sevenDaysAgoStr)
    .map(serializeDailyRow);

  const last30Days = dailyUsage.map(serializeDailyRow);

  // Compute today's summary
  const todaySummary = today.length > 0
    ? today[0]
    : { date: todayStr, totalTokens: 0, inputTokens: 0, outputTokens: 0, callCount: 0 };

  return NextResponse.json({
    studentId,
    studentName: student.displayName,
    today: todaySummary,
    last7Days,
    last30Days,
    quota: {
      allowed: quotaStatus.allowed,
      tokensUsedToday: quotaStatus.tokensUsedToday,
      softCap: quotaStatus.softCap,
      hardCap: quotaStatus.hardCap,
      warning: quotaStatus.warning ?? null,
    },
  });
});
