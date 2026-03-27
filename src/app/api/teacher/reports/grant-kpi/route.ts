import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { computeGrantKpis, currentProgramYear } from "@/lib/grant-kpi";

export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const programYear = url.searchParams.get("programYear") ?? currentProgramYear();
  if (!/^PY\d{4}$/.test(programYear)) {
    return NextResponse.json({ error: "Invalid programYear format. Expected PYnnnn." }, { status: 400 });
  }

  // Derive date range from program year (PY2026 = July 1 2025 – June 30 2026)
  const pyNum = parseInt(programYear.replace("PY", ""), 10);
  const startDate = new Date(`${pyNum - 1}-07-01`);
  const endDate = new Date(`${pyNum}-07-01`);

  const records = await prisma.spokesRecord.findMany({
    where: {
      referralDate: { gte: startDate, lt: endDate },
    },
    select: {
      id: true,
      status: true,
      referralDate: true,
      enrolledAt: true,
      unsubsidizedEmploymentAt: true,
      hourlyWage: true,
      postSecondaryEnteredAt: true,
      employmentFollowUps: {
        select: {
          checkpointMonths: true,
          status: true,
        },
      },
    },
  });

  return NextResponse.json(computeGrantKpis(records));
});
