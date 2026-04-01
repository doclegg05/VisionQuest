import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { currentProgramYear } from "@/lib/grant-kpi";
import { getGrantKpiHistory } from "@/lib/grant-kpi-history";

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const programYear = url.searchParams.get("programYear") ?? currentProgramYear();

  if (!/^PY\d{4}$/.test(programYear)) {
    return NextResponse.json({ error: "Invalid programYear format." }, { status: 400 });
  }

  const classId = url.searchParams.get("classId")?.trim() || undefined;
  if (classId) {
    await assertStaffCanManageClass(session, classId);
  }

  const snapshots = await getGrantKpiHistory(programYear, classId);

  return NextResponse.json({
    programYear,
    snapshots: snapshots.map((snapshot) => ({
      date: snapshot.snapshotDate.toISOString().slice(0, 10),
      metrics: snapshot.metrics,
      counts: snapshot.counts,
    })),
  });
});
