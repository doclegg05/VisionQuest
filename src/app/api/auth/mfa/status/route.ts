import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: {
      mfaEnabled: true,
      mfaVerifiedAt: true,
      mfaBackupCodes: true,
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({
    enabled: student.mfaEnabled,
    backupCodesRemaining: student.mfaBackupCodes.length,
    verifiedAt: student.mfaVerifiedAt?.toISOString() ?? null,
  });
});
