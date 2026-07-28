import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { activateLocalTaskRouting } from "@/lib/ai/local-routing-rollout";
import { parseBody } from "@/lib/schemas";
import { z } from "zod";

const activationSchema = z.object({
  defaultModel: z.string().trim().min(1).max(100),
  speedModel: z.string().trim().min(1).max(100),
  qualityModel: z.string().trim().min(1).max(100),
  enabled: z.literal(true),
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, activationSchema);
  const result = await activateLocalTaskRouting({
    actorId: session.id,
    defaultModel: body.defaultModel,
    speedModel: body.speedModel,
    qualityModel: body.qualityModel,
    enabled: true,
  });

  return NextResponse.json(result);
});
