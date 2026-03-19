import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { badRequest } from "@/lib/api-error";

const PLATFORM_GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/**
 * Resolve the Gemini API key for a student.
 * Tries personal (encrypted) key first, falls back to platform key.
 * Throws badRequest if neither is available or decryption fails.
 */
export async function resolveApiKey(studentId: string): Promise<string> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { geminiApiKey: true },
  });

  if (!student?.geminiApiKey && !PLATFORM_GEMINI_API_KEY) {
    throw badRequest(
      "Sage is not configured yet. Add a personal Gemini API key in Settings or ask staff to configure the platform key.",
    );
  }

  if (student?.geminiApiKey) {
    try {
      return decrypt(student.geminiApiKey);
    } catch {
      throw badRequest("Your API key needs to be re-entered. Please update it in Settings.");
    }
  }

  return PLATFORM_GEMINI_API_KEY;
}
