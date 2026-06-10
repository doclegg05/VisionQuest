import { NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/** Weekly decay multiplier for episodic memories past the fresh window. */
const EPISODIC_DECAY = 0.95;
const FRESH_WINDOW_DAYS = 30;
const ARCHIVE_BELOW_CONFIDENCE = 0.2;

/**
 * POST /api/internal/memory/consolidate
 *
 * Weekly memory maintenance (Phase 2):
 * 1. Decay confidence of episodic memories older than the fresh window —
 *    events fade; semantic/procedural facts do not decay automatically.
 * 2. Archive (validTo = now) active memories whose confidence dropped below
 *    the floor. Archived rows are history, never deleted.
 *
 * Insert-time dedupe is enforced by the partial unique index
 * SageMemory_subject_sourceHash_active_key, so no dedupe pass is needed here.
 *
 * Auth: Bearer CRON_SECRET. Registered in pg_cron as 'sage-memory-consolidate'.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const decayed = await prisma.$executeRaw`
      UPDATE "visionquest"."SageMemory"
      SET confidence = confidence * ${EPISODIC_DECAY}, "updatedAt" = now()
      WHERE kind = 'episodic'
        AND "validTo" IS NULL
        AND "validFrom" < now() - make_interval(days => ${FRESH_WINDOW_DAYS})
    `;

    const archived = await prisma.$executeRaw`
      UPDATE "visionquest"."SageMemory"
      SET "validTo" = now(), "updatedAt" = now()
      WHERE "validTo" IS NULL
        AND confidence < ${ARCHIVE_BELOW_CONFIDENCE}
    `;

    const durationMs = Date.now() - start;
    logger.info("Memory consolidation complete", { decayed, archived, durationMs });
    return NextResponse.json({ success: true, data: { decayed, archived, durationMs } });
  } catch (error) {
    logger.error("Memory consolidation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Consolidation failed" }, { status: 500 });
  }
}
