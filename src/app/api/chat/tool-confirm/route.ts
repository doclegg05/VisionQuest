import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest } from "@/lib/api-error";
import { executeAgentTool } from "@/lib/sage/agent/executor";
import { verifyConfirmationToken } from "@/lib/sage/agent/confirmation";

const confirmSchema = z.object({
  toolName: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()),
  token: z.string().min(1).max(512),
  conversationId: z.string().cuid(),
});

/**
 * POST /api/chat/tool-confirm — execute a previously-proposed write tool
 * (Phase 3 confirm-before-execute).
 *
 * The HMAC token binds (tool, args, session, conversation, expiry), so a
 * confirmed call is byte-identical to what the user saw on the card. Wrong
 * user, altered args, or an expired card all fail verification here BEFORE
 * the executor runs; the executor then re-verifies inside the tool itself.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = confirmSchema.safeParse(await req.json());
  if (!body.success) throw badRequest("Invalid confirmation request.");

  const { toolName, args, token, conversationId } = body.data;

  const valid = verifyConfirmationToken(
    token,
    { toolName, args, sessionId: session.id, conversationId },
    new Date(),
  );
  if (!valid) {
    throw badRequest("This confirmation has expired or is invalid. Ask Sage again.");
  }

  const record = await executeAgentTool({
    session,
    conversationId,
    toolName,
    args,
    confirmedToken: token,
  });

  return NextResponse.json({
    success: record.result.status === "success",
    data: {
      summary: record.result.summary,
      status: record.result.status,
      data: record.result.data ?? null,
    },
  });
});
