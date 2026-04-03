import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, badRequest } from "@/lib/api-error";
import { getConfigValue, setConfigValue, deleteConfigValue } from "@/lib/system-config";
import { decrypt } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/schemas";
import { z } from "zod";

const apiKeySchema = z.object({
  apiKey: z.string().min(1, "API key is required.").max(500, "API key is too long."),
});

export const GET = withAdminAuth(async () => {
  const row = await prisma.systemConfig.findUnique({
    where: { key: "gemini_api_key" },
    select: { value: true, updatedAt: true, updatedBy: true },
  });

  let status: "connected" | "no_key" | "invalid_key" = "no_key";
  let keyHint: string | null = null;
  let updatedAt: string | null = null;
  let updatedBy: string | null = null;

  if (row?.value) {
    try {
      const decrypted = decrypt(row.value);
      keyHint = "..." + decrypted.slice(-4);
      status = "connected";
      updatedAt = row.updatedAt.toISOString();
      updatedBy = row.updatedBy;
    } catch {
      status = "invalid_key";
    }
  }

  const envKeyConfigured = Boolean(process.env.GEMINI_API_KEY);

  return NextResponse.json({ status, keyHint, updatedAt, updatedBy, envKeyConfigured });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, apiKeySchema);
  const apiKey = body.apiKey.trim();

  if (!apiKey.startsWith("AIza")) {
    throw badRequest("That doesn't look like a Gemini API key. Keys start with 'AIza'.");
  }

  await setConfigValue("gemini_api_key", apiKey, session.id);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_config.save_key",
    targetType: "system_config",
    targetId: "gemini_api_key",
    summary: `Admin saved a new platform Gemini API key.`,
  });

  return NextResponse.json({ success: true });
});

export const DELETE = withAdminAuth(async (session) => {
  await deleteConfigValue("gemini_api_key");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_config.delete_key",
    targetType: "system_config",
    targetId: "gemini_api_key",
    summary: `Admin removed the platform Gemini API key.`,
  });

  return NextResponse.json({ success: true });
});
