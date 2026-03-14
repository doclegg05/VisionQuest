import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { geminiApiKey: true },
  });

  let hasKey = false;
  let keyHint: string | null = null;
  if (student?.geminiApiKey) {
    try {
      const decryptedKey = decrypt(student.geminiApiKey);
      hasKey = true;
      keyHint = "..." + decryptedKey.slice(-4);
    } catch {
      // Key stored in old unencrypted format — treat as present
      hasKey = true;
      keyHint = "..." + student.geminiApiKey.slice(-4);
    }
  }

  const platformKeyConfigured = Boolean(process.env.GEMINI_API_KEY);

  return Response.json({
    hasKey,
    keyHint,
    platformKeyConfigured,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
  }

  const rl = await rateLimit(`api-key:${session.id}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json();
  const apiKey = (body.apiKey || "").trim();

  if (!apiKey) {
    return Response.json({ error: "API key is required." }, { status: 400 });
  }

  // Basic format validation
  if (!apiKey.startsWith("AIza")) {
    return Response.json(
      { error: "That doesn't look like a Gemini API key. Keys start with 'AIza'." },
      { status: 400 }
    );
  }

  // Test the key by making a quick API call
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const testAI = new GoogleGenerativeAI(apiKey);
    const model = testAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    await model.generateContent("Say hi in one word.");
  } catch {
    return Response.json(
      { error: "This API key didn't work. Double-check that you copied it correctly and that it's enabled." },
      { status: 400 }
    );
  }

  await prisma.student.update({
    where: { id: session.id },
    data: { geminiApiKey: encrypt(apiKey) },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "settings.api_key_saved",
    targetType: "student",
    targetId: session.id,
    summary: `Student saved a new Gemini API key.`,
  });

  return Response.json({ success: true });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 });
  }

  await prisma.student.update({
    where: { id: session.id },
    data: { geminiApiKey: null },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "settings.api_key_deleted",
    targetType: "student",
    targetId: session.id,
    summary: `Student deleted their Gemini API key.`,
  });

  return Response.json({ success: true });
}
