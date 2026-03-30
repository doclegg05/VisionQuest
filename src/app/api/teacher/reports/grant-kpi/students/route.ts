import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { currentProgramYear } from "@/lib/grant-kpi";

const VALID_METRICS = [
  "enrollment",
  "placement",
  "high_wage",
  "post_secondary",
  "retention_3mo",
  "retention_6mo",
] as const;

type MetricKey = (typeof VALID_METRICS)[number];

function isValidMetric(v: string): v is MetricKey {
  return (VALID_METRICS as readonly string[]).includes(v);
}

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);

  const metric = url.searchParams.get("metric") ?? "";
  if (!isValidMetric(metric)) {
    return NextResponse.json(
      { error: `Invalid metric. Expected one of: ${VALID_METRICS.join(", ")}` },
      { status: 400 },
    );
  }

  const programYear = url.searchParams.get("programYear") ?? currentProgramYear();
  if (!/^PY\d{4}$/.test(programYear)) {
    return NextResponse.json({ error: "Invalid programYear format." }, { status: 400 });
  }

  const classId = url.searchParams.get("classId") ?? undefined;
  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: true,
  });

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
      firstName: true,
      lastName: true,
      status: true,
      referralDate: true,
      enrolledAt: true,
      unsubsidizedEmploymentAt: true,
      hourlyWage: true,
      postSecondaryEnteredAt: true,
      employmentFollowUps: {
        select: { checkpointMonths: true, status: true },
      },
    },
  });

  const filtered = records.filter((r) => matchesMetric(r, metric));

  const students = filtered.map((r) => ({
    spokesRecordId: r.id,
    studentId: r.studentId,
    name: `${r.firstName} ${r.lastName}`,
    status: r.status,
    referralDate: r.referralDate,
    enrolledAt: r.enrolledAt,
    employedAt: r.unsubsidizedEmploymentAt,
    hourlyWage: r.hourlyWage,
    postSecondaryAt: r.postSecondaryEnteredAt,
  }));

  return NextResponse.json({ metric, programYear, count: students.length, students });
});

type RecordRow = {
  status: string;
  enrolledAt: Date | null;
  unsubsidizedEmploymentAt: Date | null;
  hourlyWage: number | null;
  postSecondaryEnteredAt: Date | null;
  employmentFollowUps: { checkpointMonths: number; status: string }[];
};

function matchesMetric(r: RecordRow, metric: MetricKey): boolean {
  switch (metric) {
    case "enrollment":
      return r.enrolledAt !== null;
    case "placement":
      return r.unsubsidizedEmploymentAt !== null;
    case "high_wage":
      return r.unsubsidizedEmploymentAt !== null && (r.hourlyWage ?? 0) >= 15;
    case "post_secondary":
      return r.postSecondaryEnteredAt !== null;
    case "retention_3mo":
      return r.employmentFollowUps.some(
        (f) => f.checkpointMonths === 3 && f.status === "employed",
      );
    case "retention_6mo":
      return r.employmentFollowUps.some(
        (f) => f.checkpointMonths === 6 && f.status === "employed",
      );
  }
}
