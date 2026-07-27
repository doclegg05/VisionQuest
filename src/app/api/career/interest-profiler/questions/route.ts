import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api-error";
import { isOnetConfigured } from "@/lib/career/onet-config";
import { fetchMiniIpQuestions } from "@/lib/career/onet-interest-profiler";
import { rateLimit } from "@/lib/rate-limit";
import { withRegistry } from "@/lib/registry/middleware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/career/interest-profiler/questions
 * Proxies O*NET Mini-IP questions_30. Returns 503 when ONET_* env is absent.
 */
export const GET = withRegistry(
  "career.interest_profiler.questions",
  async (session, _req) => {
    const rl = await rateLimit(`ip:questions:${session.id}`, 30, 60 * 60 * 1000);
    if (!rl.success) {
      throw rateLimited("Too many Interest Profiler requests. Please wait and try again.");
    }

    if (!isOnetConfigured()) {
      return NextResponse.json(
        {
          configured: false,
          error: "not_configured",
          message:
            "Interest Profiler is not configured. You can still import scores you already have.",
        },
        { status: 503 },
      );
    }

    const result = await fetchMiniIpQuestions();
    if (!result.configured || result.error) {
      const status = result.error === "unauthorized" ? 502 : 502;
      return NextResponse.json(
        {
          configured: result.configured,
          error: result.error ?? "http_error",
          message: "Could not load Interest Profiler questions. Try again or import scores.",
        },
        { status },
      );
    }

    return NextResponse.json({
      configured: true,
      total: result.total,
      answerOptions: result.answerOptions ?? [],
      questions: result.questions ?? [],
    });
  },
);
