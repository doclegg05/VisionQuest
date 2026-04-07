import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { badRequest } from "@/lib/api-error";
import { getConfigValue } from "@/lib/system-config";

const PLATFORM_GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/**
 * Resolve the Gemini API key for a student.
 *
 * Resolution order:
 * 1. Per-student encrypted key (personal override)
 * 2. Admin-managed platform key (SystemConfig)
 * 3. Environment variable fallback
 * 4. None → throws with helpful message
 */
export async function resolveApiKey(studentId: string): Promise<string> {
  // 1. Check personal key
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { geminiApiKey: true },
  });

  if (student?.geminiApiKey) {
    try {
      return decrypt(student.geminiApiKey);
    } catch {
      throw badRequest("Your API key needs to be re-entered. Please update it in Settings.");
    }
  }

  // 2. Check admin-managed platform key
  const adminKey = await getConfigValue("gemini_api_key");
  if (adminKey) {
    return adminKey;
  }

  // 3. Check environment variable
  if (PLATFORM_GEMINI_API_KEY) {
    return PLATFORM_GEMINI_API_KEY;
  }

  // 4. No key available
  throw badRequest(
    "Sage is not configured yet. Ask your program administrator to set up the AI key in Program Setup.",
  );
}
