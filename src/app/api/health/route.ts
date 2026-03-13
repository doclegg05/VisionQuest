import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  'visionquest."Student"',
  'visionquest."RateLimitEntry"',
  'visionquest."AuditLog"',
] as const;

export async function GET() {
  const start = Date.now();

  try {
    // Verify database connectivity and signup-critical tables.
    await prisma.$queryRaw`SELECT 1`;
    const tableChecks = await Promise.all(
      REQUIRED_TABLES.map((tableName) =>
        prisma.$queryRaw<Array<{ exists: string | null }>>`
          SELECT to_regclass(${tableName}) AS exists
        `
      )
    );
    const missingTables = tableChecks
      .map((rows, index) => (rows[0]?.exists ? null : REQUIRED_TABLES[index]))
      .filter((tableName): tableName is (typeof REQUIRED_TABLES)[number] => tableName !== null);

    if (missingTables.length > 0) {
      return NextResponse.json(
        {
          status: "unhealthy",
          uptime: process.uptime(),
          db: "connected",
          schema: "missing_tables",
          missingTables,
          latency_ms: Date.now() - start,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: "healthy",
        uptime: process.uptime(),
        db: "connected",
        schema: "ready",
        latency_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        uptime: process.uptime(),
        db: "disconnected",
        latency_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
