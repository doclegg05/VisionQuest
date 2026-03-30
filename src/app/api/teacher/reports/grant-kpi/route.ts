import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { computeGrantKpis, currentProgramYear } from "@/lib/grant-kpi";

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const programYear = url.searchParams.get("programYear") ?? currentProgramYear();
  if (!/^PY\d{4}$/.test(programYear)) {
    return NextResponse.json({ error: "Invalid programYear format. Expected PYnnnn." }, { status: 400 });
  }

  const classId = url.searchParams.get("classId") ?? undefined;

  // Scope to students the teacher manages (respects classroom isolation)
  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: true,
  });

  // Derive date range from program year (PY2026 = July 1 2025 – June 30 2026)
  const pyNum = parseInt(programYear.replace("PY", ""), 10);
  const startDate = new Date(`${pyNum - 1}-07-01`);
  const endDate = new Date(`${pyNum}-07-01`);

  const records = await prisma.spokesRecord.findMany({
    where: {
      referralDate: { gte: startDate, lt: endDate },
      ...(studentIds.length > 0 ? { studentId: { in: studentIds } } : {}),
    },
    select: {
      id: true,
      studentId: true,
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

  const payload = computeGrantKpis(records);

  // CSV export when ?format=csv
  const format = url.searchParams.get("format");
  if (format === "csv") {
    const metricKeys = [
      "enrollmentRate",
      "jobPlacementRate",
      "highWagePlacementRate",
      "postSecondaryTransition",
      "threeMonthRetention",
      "sixMonthRetention",
    ] as const;

    const header = "Metric,Numerator,Denominator,Rate (%),Target (%),Meets Target";
    const rows = metricKeys.map((key) => {
      const m = payload.metrics[key];
      return [
        escapeCsv(m.label),
        m.numerator,
        m.denominator,
        m.value,
        m.target ?? "",
        m.meetsTarget === null ? "" : m.meetsTarget ? "Yes" : "No",
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="grant-kpi-${programYear}.csv"`,
      },
    });
  }

  return NextResponse.json(payload);
});

function escapeCsv(val: string | number | boolean) {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
