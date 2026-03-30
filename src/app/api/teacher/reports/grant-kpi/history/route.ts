import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { currentProgramYear } from "@/lib/grant-kpi";
import { getGrantKpiHistory } from "@/lib/grant-kpi-history";

/**
 * GET — Retrieve historical grant KPI snapshots for trend charts.
 *
 * Query params:
 *   programYear (optional, default: current PY)
 *   classId (optional, scope to class)
 */
export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const programYear = url.searchParams.get("programYear") ?? currentProgramYear();

  if (!/^PY\d{4}$/.test(programYear)) {
    return NextResponse.json({ error: "Invalid programYear format." }, { status: 400 });
  }

  const classId = url.searchParams.get("classId") ?? undefined;
  const snapshots = await getGrantKpiHistory(programYear, classId);

  return NextResponse.json({
    programYear,
    snapshots: snapshots.map((s) => ({
      date: s.snapshotDate.toISOString().slice(0, 10),
      metrics: s.metrics,
      counts: s.counts,
    })),
  });
});
