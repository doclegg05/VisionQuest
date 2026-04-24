import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { generateAiSafetyReport } from "@/lib/ai/safety-report";

export const GET = withAdminAuth(async (session, req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const days = Number.parseInt(searchParams.get("days") || "30", 10);
  const report = await generateAiSafetyReport(session, Number.isFinite(days) ? days : 30);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_safety_report.generate",
    targetType: "ai_compliance_report",
    targetId: report.reportHash.slice(0, 16),
    summary: "Admin generated an AI student information protection audit report.",
    metadata: {
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      periodDays: report.periodDays,
      reportHash: report.reportHash,
      sensitiveCloudRoutes: report.auditSummary.sensitiveCloudRoutes,
      contentLogged: false,
    },
  });

  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
});
