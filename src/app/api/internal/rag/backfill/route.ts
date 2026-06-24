import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { backfillProgramDocumentEmbeddings } from "@/lib/sage/backfill-embeddings";

// ~50 docs at 1-2 minutes total; give the embed loop room on Render.
export const maxDuration = 300;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

const bodySchema = z.object({ force: z.boolean().optional() });

/**
 * POST /api/internal/rag/backfill
 *
 * One-curl production embedding backfill for ProgramDocument — same flow as
 * `npm run sage:rag:backfill`, exposed so prod can be backfilled without a
 * Render shell:
 *
 *   curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Idempotent: already-embedded docs are skipped unless `{ "force": true }`.
 * Auth: Bearer CRON_SECRET (same pattern as /api/internal/memory/consolidate).
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let force = false;
  const raw = await req.text();
  if (raw) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    force = parsed.data.force ?? false;
  }

  const start = Date.now();
  try {
    const tally = await backfillProgramDocumentEmbeddings({ force });
    const durationMs = Date.now() - start;
    logger.info("RAG embedding backfill complete", { ...tally, force, durationMs });
    return NextResponse.json({ success: true, data: { ...tally, durationMs } });
  } catch (error) {
    logger.error("RAG embedding backfill failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
