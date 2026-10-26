import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { badRequest } from "@/lib/api-error";
import { getConfigValue } from "@/lib/system-config";

const PLATFORM_GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export interface ResolveApiKeyOptions {
  /**
   * Whether the student's own encrypted Gemini key may serve this call.
   * Defaults to `true`, which is the resolution order every existing caller
   * relies on.
   *
   * `resolveAiProvider` and `resolveEmbeddingProvider` pass `false` for every
   * student_record / staff_entered call. A personal key is a consumer
   * AI-Studio key the student pasted into Settings: it sits outside any
   * program-level agreement VisionQuest holds with the vendor (no DPA, no
   * school-official designation, possibly the unpaid tier that permits
   * training and human review), so a student-record prompt sent under it
   * would leave every contractual protection behind (FERPA review 2026-09-06,
   * report C2). Public-program prompts carry no student content and may keep
   * the personal key.
   */
  allowPersonalKey?: boolean;
}

/**
 * Resolve the Gemini API key for a student.
 *
 * Resolution order:
 * 1. Per-student encrypted key (personal override) — only when
 *    `allowPersonalKey` is not `false`
 * 2. Admin-managed platform key (SystemConfig)
 * 3. Environment variable fallback
 * 4. None → throws with helpful message
 */
export async function resolveApiKey(
  studentId: string,
  opts: ResolveApiKeyOptions = {},
): Promise<string> {
  const allowPersonalKey = opts.allowPersonalKey ?? true;

  // 1. Check personal key. Skipped entirely — no row read, no decrypt — when
  //    the caller has ruled it out, so the key can never leak into the call
  //    through a later refactor of this branch.
  if (allowPersonalKey && studentId) {
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
