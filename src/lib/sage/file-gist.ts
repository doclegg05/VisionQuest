/**
 * File gist extraction for chat uploads (Phase 3).
 *
 * The gist is a short text description of an uploaded document that gets
 * injected into Sage's turn context so she can discuss/classify the file.
 *
 * Routing honors the recorded-consent decision (2026-06-09):
 * - WITH active cloud_file_processing consent: the document bytes go to
 *   Gemini for native document understanding (inline_data transport — same
 *   cloud-processing boundary as the Files API; switch to the Files API if
 *   48h reuse across turns is ever needed).
 * - WITHOUT consent: local deterministic extraction only
 *   (extractTextFromBuffer); image-only files get a stub gist.
 */

import { extractTextFromBuffer } from "./extract";
import { logger } from "@/lib/logger";
import { logLlmCall } from "@/lib/llm-usage";
import { GEMINI_MODEL } from "@/lib/gemini";

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

async function cloudGist(
  buffer: Buffer,
  mimeType: string,
  studentId: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || buffer.length > INLINE_CLOUD_LIMIT_BYTES) return null;

  const startedAt = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: buffer.toString("base64") } },
              { text: CLOUD_GIST_PROMPT },
            ],
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    logger.warn("Cloud gist extraction failed", { status: response.status });
    return null;
  }

  const json = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

  await logLlmCall({
    studentId,
    callSite: "chat_file_gist",
    model: GEMINI_MODEL,
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
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
