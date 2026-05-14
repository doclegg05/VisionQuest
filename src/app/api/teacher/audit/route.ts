import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

export const GET = withAdminAuth(async (_session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  // No `where` filter is intentional: this is an admin-only system audit view
  // (route is gated by `withAdminAuth`, and the AuditLog RLS policy
  // `audit_log_admin_only` requires app.current_role = 'admin' to read).
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
