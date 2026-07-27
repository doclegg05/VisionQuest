import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimited } from "@/lib/api-error";
import {
  coerceManualScores,
  normalizeOnetScores,
  writeFormalRiasec,
} from "@/lib/career/formal-riasec";
import { isOnetConfigured } from "@/lib/career/onet-config";
import { fetchMiniIpResults } from "@/lib/career/onet-interest-profiler";
import { rateLimit } from "@/lib/rate-limit";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody } from "@/lib/schemas";
import type { RiasecScores } from "@/lib/sage/discovery-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const riasecSchema = z.object({
  realistic: z.number(),
  investigative: z.number(),
  artistic: z.number(),
  social: z.number(),
  enterprising: z.number(),
  conventional: z.number(),
});

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("onet"),
    answers: z.string().min(30).max(60),
  }),
  z.object({
    mode: z.literal("manual"),
    scores: riasecSchema,
    hollandCode: z.string().max(8).optional().nullable(),
  }),
]);

/**
 * POST /api/career/interest-profiler
 * mode=onet  — score via O*NET Results, write formal RIASEC
 * mode=manual — import six scores, write formal RIASEC
 */
export const POST = withRegistry(
  "career.interest_profiler.submit",
  async (session, req) => {
    const rl = await rateLimit(`ip:submit:${session.id}`, 20, 60 * 60 * 1000);
    if (!rl.success) {
      throw rateLimited("Too many Interest Profiler submissions. Please wait and try again.");
    }

    const body = await parseBody(req, bodySchema);

    if (body.mode === "onet") {
      if (!isOnetConfigured()) {
        return NextResponse.json(
          {
            ok: false,
            error: "not_configured",
            message: "Interest Profiler scoring is not configured. Import scores instead.",
          },
          { status: 503 },
        );
      }

      const scored = await fetchMiniIpResults(body.answers);
      if (!scored.configured || scored.error || !scored.rawScores) {
        return NextResponse.json(
          {
            ok: false,
            error: scored.error ?? "http_error",
            message: "Could not score your answers. Try again or import scores.",
          },
          { status: 502 },
        );
      }

      const raw = scored.rawScores;
      const normalized = normalizeOnetScores(raw);
      const written = await writeFormalRiasec({
        studentId: session.id,
        source: "onet_mini_ip",
        instrument: "onet_mini_ip_30",
        raw,
        normalized,
        actorId: session.id,
        actorRole: session.role,
      });

      return NextResponse.json({
        ok: true,
        source: "onet_mini_ip",
        hollandCode: written.hollandCode,
        scores: written.normalized as RiasecScores,
        snapshotId: written.snapshotId,
        profilePath: "/career/profile",
      });
    }

    const { raw, normalized } = coerceManualScores(body.scores);
    const written = await writeFormalRiasec({
      studentId: session.id,
      source: "manual_entry",
      instrument: "manual_riasec_import",
      raw,
      normalized,
      hollandCode: body.hollandCode,
      actorId: session.id,
      actorRole: session.role,
    });

    return NextResponse.json({
      ok: true,
      source: "manual_entry",
      hollandCode: written.hollandCode,
      scores: written.normalized as RiasecScores,
      snapshotId: written.snapshotId,
      profilePath: "/career/profile",
    });
  },
);
