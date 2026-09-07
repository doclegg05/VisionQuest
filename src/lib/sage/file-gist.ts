/**
 * File gist extraction for chat uploads (Phase 3).
 *
 * The gist is a short text description of an uploaded document that gets
 * injected into Sage's turn context so she can discuss/classify the file.
 *
 * Routing honors the recorded-consent decision (2026-06-09) AND the AI
 * routing rules, in that order:
 * - WITHOUT active cloud_file_processing consent: local deterministic
 *   extraction only (extractTextFromBuffer); image-only files get a stub
 *   gist. The resolver is never consulted.
 * - WITH consent: the provider is resolved through `resolveAiProvider`
 *   (`chat_file_gist`, `student_record`), so `ai_provider = "local"` and
 *   `ai_cloud_policy` govern this path like every other model call. Only a
 *   provider that implements `describeDocument` (Gemini) receives the bytes
 *   (inline_data transport — same cloud-processing boundary as the Files
 *   API); a local provider has no such method, so the cloud path declines
 *   and local extraction runs instead. Every decision writes an AI audit
 *   event; the upload route writes the final `completed` event.
 *
 * Until 2026-09 this file posted the bytes to Gemini by raw `fetch` with
 * `process.env.GEMINI_API_KEY`, bypassing the resolver entirely (FERPA
 * review, Known Issues). The consent scope stays an ADDITIONAL gate in
 * /api/chat/upload, never the only one.
 */

import { extractTextFromBuffer } from "./extract";
import { logger } from "@/lib/logger";
import { logLlmCall } from "@/lib/llm-usage";
import { resolveAiProvider } from "@/lib/ai/provider";
import { AiCloudRefusedError } from "@/lib/ai/lanes";
import {
  getProviderClass,
  logAiAuditEvent,
  policyDecisionForProvider,
} from "@/lib/ai/audit";
import type { AIProvider, TokenUsage } from "@/lib/ai/types";

const GIST_MAX_CHARS = 600;
const INLINE_CLOUD_LIMIT_BYTES = 15 * 1024 * 1024; // inline_data request ceiling

const CLOUD_GIST_PROMPT =
  "Describe this document for a case-management assistant in at most 80 words: what kind of document it is, its apparent purpose, whether it appears signed/filled out, and any key identifiers (form numbers, titles). Plain text only.";

export interface FileGistResult {
  gist: string;
  /** Which path produced the gist — recorded for the AI audit trail. */
  method: "cloud" | "local" | "none";
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > GIST_MAX_CHARS ? `${collapsed.slice(0, GIST_MAX_CHARS)}…` : collapsed;
}

function providerModel(provider: AIProvider): string {
  return (provider as { model?: string }).model?.trim() || provider.name;
}

/**
 * The cloud gist. Returns null — and lets the caller fall back to local
 * extraction — whenever the resolved provider cannot or may not read the
 * document. Throws only when the provider call itself fails, so the caller's
 * existing fallback still applies.
 */
async function cloudGist(
  buffer: Buffer,
  mimeType: string,
  studentId: string,
): Promise<string | null> {
  if (buffer.length > INLINE_CLOUD_LIMIT_BYTES) return null;

  let provider: AIProvider;
  try {
    provider = await resolveAiProvider({
      studentId,
      task: "chat_file_gist",
      sensitivity: "student_record",
    });
  } catch (error) {
    // The policy refused the cloud for this lane; the resolver already wrote
    // the blocked audit event. Local extraction is the only path left.
    if (error instanceof AiCloudRefusedError) return null;
    throw error;
  }

  const providerClass = getProviderClass(provider.name);
  const auditBase = {
    actorId: studentId,
    actorRole: "student",
    targetId: studentId,
    route: "sage.file_gist",
    task: "chat_file_gist" as const,
    sensitivity: "student_record" as const,
    policyDecision: policyDecisionForProvider(provider.name),
    providerName: provider.name,
    providerClass,
  };

  if (!provider.describeDocument) {
    // A local provider: there is no way to hand it the bytes, and that is the
    // routing rule working. Recorded so the FERPA report can tell "consent
    // given, cloud declined" from "no consent".
    await logAiAuditEvent({
      ...auditBase,
      status: "blocked",
      allowCloud: false,
      reason: "The resolved provider cannot read document bytes; local extraction only.",
      errorCode: "NO_DOCUMENT_CAPABILITY",
    });
    return null;
  }

  const allowCloud = providerClass === "cloud";
  await logAiAuditEvent({ ...auditBase, status: "routed", allowCloud, inputChars: buffer.length });

  const startedAt = Date.now();
  // Collected rather than assigned: TypeScript narrows a `let x = null`
  // captured by a callback to `null` at the read site, so the value the
  // provider reported would type as `never` below.
  const usages: TokenUsage[] = [];
  let text: string;
  try {
    text = await provider.describeDocument(buffer, mimeType, CLOUD_GIST_PROMPT, {
      onUsage: (reported) => {
        usages.push(reported);
      },
    });
  } catch (error) {
    await logAiAuditEvent({
      ...auditBase,
      status: "failed",
      allowCloud,
      errorCode: "provider_error",
      reason: String(error).slice(0, 200),
    });
    throw error;
  }

  const reported = usages[0];
  await logLlmCall({
    studentId,
    callSite: "chat_file_gist",
    model: providerModel(provider),
    inputTokens: reported?.inputTokens ?? 0,
    outputTokens: reported?.outputTokens ?? 0,
    totalTokens: reported?.totalTokens ?? 0,
    durationMs: Date.now() - startedAt,
  });

  return text.trim() ? truncate(text) : null;
}

function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export async function buildFileGist(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  studentId: string;
  cloudAllowed: boolean;
}): Promise<FileGistResult> {
  const { buffer, filename, mimeType, studentId, cloudAllowed } = params;

  if (cloudAllowed) {
    try {
      const gist = await cloudGist(buffer, mimeType, studentId);
      if (gist) return { gist, method: "cloud" };
    } catch (error) {
      logger.warn("Cloud gist threw; falling back to local extraction", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const extraction = await extractTextFromBuffer(buffer, extFromFilename(filename), {
    maxChars: 2000,
    maxPages: 3,
  });
  if (extraction?.text) {
    return { gist: truncate(extraction.text), method: "local" };
  }

  return {
    gist: cloudAllowed
      ? "(file content could not be read)"
      : "(file content not analyzed — cloud document processing is off for this student; readable text extraction found none)",
    method: "none",
  };
}
