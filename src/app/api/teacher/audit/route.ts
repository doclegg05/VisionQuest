import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(async (_session, req: Request) => {

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    logs: logs.map((log) => ({
      ...log,
      metadata: (() => {
        if (!log.metadata) return null;
        try {
          return JSON.parse(log.metadata);
        } catch {
          return null;
        }
      })(),
    })),
  });
});
