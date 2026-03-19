import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { buildSpokesSummary } from "@/lib/spokes";

export const GET = withTeacherAuth(async (_session) => {
  const [checklistTemplates, moduleTemplates, records] = await Promise.all([
    prisma.spokesChecklistTemplate.findMany(),
    prisma.spokesModuleTemplate.findMany(),
    prisma.spokesRecord.findMany({
      include: {
        student: {
          select: {
            id: true,
            studentId: true,
            displayName: true,
          },
        },
        checklistProgress: true,
        moduleProgress: true,
        employmentFollowUps: true,
      },
      orderBy: [{ updatedAt: "desc" }, { lastName: "asc" }],
    }),
  ]);

  const now = new Date();
  const rows = records.map((record) => {
    const summary = buildSpokesSummary({
      record,
      checklistTemplates,
      checklistProgress: record.checklistProgress,
      moduleTemplates,
      moduleProgress: record.moduleProgress,
      employmentFollowUps: record.employmentFollowUps,
      now,
    });

    const reasons: string[] = [];
    if (!record.enrolledAt && record.referralDate) {
      reasons.push("Referral logged but not enrolled");
    }
    if (record.enrolledAt && !summary.orientation.isComplete) {
      reasons.push("Orientation paperwork incomplete");
    }
    if (record.enrolledAt && !summary.programFiles.isComplete) {
      reasons.push("Program files incomplete");
    }
    if (record.enrolledAt && !summary.modules.isComplete) {
      reasons.push("Required modules still in progress");
    }
    if (
      record.enrolledAt &&
      !record.familySurveyOfferedAt &&
      now.getTime() - record.enrolledAt.getTime() >= 28 * 24 * 60 * 60 * 1000
    ) {
      reasons.push("WV Family Survey still not offered");
    }
    if (summary.employmentFollowUpsDue > 0) {
      reasons.push("Employment follow-up due");
    }

    return {
      id: record.id,
      studentId: record.student?.studentId ?? null,
      studentName: record.student?.displayName ?? `${record.firstName} ${record.lastName}`.trim(),
      status: record.status,
      orientationDone: summary.orientation.done,
      orientationTotal: summary.orientation.total,
      filesDone: summary.programFiles.done,
      filesTotal: summary.programFiles.total,
      modulesDone: summary.modules.done,
      modulesTotal: summary.modules.total,
      familySurveyOffered: summary.familySurveyOffered,
      postSecondaryEntered: summary.postSecondaryEntered,
      employmentFollowUpsDue: summary.employmentFollowUpsDue,
      employmentFollowUpsCompleted: summary.employmentFollowUpsCompleted,
      reasons,
    };
  });

  const summary = {
    totalRecords: rows.length,
    referred: rows.filter((row) => row.status === "referred").length,
    enrolled: rows.filter((row) => row.status === "enrolled").length,
    completed: rows.filter((row) => row.status === "completed").length,
    exited: rows.filter((row) => row.status === "exited").length,
    nonCompleters: rows.filter((row) => row.status === "non_completer").length,
    orientationComplete: rows.filter(
      (row) => row.orientationTotal > 0 && row.orientationDone >= row.orientationTotal
    ).length,
    filesComplete: rows.filter((row) => row.filesTotal > 0 && row.filesDone >= row.filesTotal).length,
    modulesComplete: rows.filter((row) => row.modulesTotal > 0 && row.modulesDone >= row.modulesTotal).length,
    familySurveyOffered: rows.filter((row) => row.familySurveyOffered).length,
    postSecondaryEntered: rows.filter((row) => row.postSecondaryEntered).length,
    followUpsDue: rows.reduce((sum, row) => sum + row.employmentFollowUpsDue, 0),
    followUpsCompleted: rows.reduce((sum, row) => sum + row.employmentFollowUpsCompleted, 0),
  };

  const attentionQueue = rows
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || a.studentName.localeCompare(b.studentName))
    .slice(0, 12);

  return NextResponse.json({
    summary,
    attentionQueue,
    records: rows,
  });
});
