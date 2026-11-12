import { NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import { getMissingRequiredTables } from "@/lib/health";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { getSageAvailability } from "@/lib/sage-availability";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  try {
    // Verify database connectivity and signup-critical tables.
    await prisma.$queryRaw`SELECT 1`;
    const missingTables = await getMissingRequiredTables(prisma);

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

    const databaseLatencyMs = Date.now() - start;
    const sage = await getSageAvailability();
    return NextResponse.json(
      {
        status: "healthy",
        sage,
        uptime: process.uptime(),
        db: "connected",
        schema: "ready",
        latency_ms: databaseLatencyMs,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Health check failed", { error: errorForLog(error) });
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
