/**
 * Structured classification for chat attachments (vision).
 *
 * Where `file-gist.ts` produces a short free-text description injected into
 * Sage's turn context, this produces a STRUCTURED classification Sage can act
 * on — detecting the document kind plus extracted fields (credential/form
 * title, issuer, date, identifiers). Those fields let Sage drive write tools
 * (add_portfolio_item, file_document as cert_evidence) with concrete values
 * instead of guessing from the gist.
 *
 * Routing mirrors file-gist and honors the recorded-consent decision
 * (2026-06-09):
 * - WITH active cloud_file_processing consent: document bytes go to Gemini for
 *   native document understanding (inline_data transport — same cloud boundary
 *   as the gist path).
 * - WITHOUT consent: local deterministic text extraction + keyword heuristics.
 *   Image-only files with no readable text fall through to method "none".
 */

import { extractTextFromBuffer } from "./extract";
import { logger } from "@/lib/logger";
import { logLlmCall } from "@/lib/llm-usage";
import { GEMINI_MODEL } from "@/lib/gemini";

const INLINE_CLOUD_LIMIT_BYTES = 15 * 1024 * 1024; // inline_data request ceiling
const SUMMARY_MAX_CHARS = 400;

export const ATTACHMENT_KINDS = [
  "certificate",
  "form",
  "resume",
  "id_document",
  "transcript",
  "letter",
  "receipt",
  "photo",
  "other",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export type ClassificationConfidence = "high" | "medium" | "low";

export interface AttachmentClassification {
  /** Best-guess document kind. */
  kind: AttachmentKind;
  /** Credential/form/document title, or null if not identifiable. */
  title: string | null;
  /** Issuing organization or authority, or null. */
  issuer: string | null;
  /** Date earned/issued as it appears on the document, or null. */
  dateOn: string | null;
  /**
   * Whether the document looks finished — a cert appears awarded, a form
   * appears signed/filled. null when it can't be determined.
   */
  isCompleted: boolean | null;
  /** Form numbers, certificate IDs, or other identifiers found. */
  identifiers: string[];
  /** One-line human summary, <= ~60 words. */
  summary: string;
  /** How sure the classifier is. */
  confidence: ClassificationConfidence;
}

export interface ClassifyAttachmentResult {
  classification: AttachmentClassification;
  /** Which path produced the result — recorded for the AI audit trail. */
  method: "cloud" | "local" | "none";
}

const CLOUD_PROMPT =
  "You are classifying a document a workforce-development student uploaded in chat. " +
  "Identify what it is and extract key fields. Respond ONLY with JSON matching the schema. " +
  "kind: certificate | form | resume | id_document | transcript | letter | receipt | photo | other. " +
  "title: the credential/form/document name (e.g. \"IC3 Digital Literacy Certification\", \"DoHS Attendance Contract\") or null. " +
  "issuer: the issuing organization/authority or null. " +
  "dateOn: a date earned/issued exactly as printed, or null. " +
  "isCompleted: true if a certificate looks awarded or a form looks signed/filled, false if blank/unsigned, null if unclear. " +
  "identifiers: array of form numbers / certificate IDs found (empty array if none). " +
  "summary: at most 60 words, plain text. " +
  "confidence: high | medium | low.";

// Gemini responseSchema — an OpenAPI subset. Keeps the model's JSON shape stable.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...ATTACHMENT_KINDS] },
    title: { type: "string", nullable: true },
    issuer: { type: "string", nullable: true },
    dateOn: { type: "string", nullable: true },
    isCompleted: { type: "boolean", nullable: true },
    identifiers: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["kind", "summary", "confidence"],
} as const;

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

function isKind(value: unknown): value is AttachmentKind {
  return typeof value === "string" && (ATTACHMENT_KINDS as ReadonlyArray<string>).includes(value);
}

function isConfidence(value: unknown): value is ClassificationConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize an untrusted model JSON object into a well-formed classification.
 * Exported for unit testing the parsing layer.
 */
export function normalizeClassification(raw: unknown): AttachmentClassification | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isKind(obj.kind)) return null;

  const identifiers = Array.isArray(obj.identifiers)
    ? obj.identifiers.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
    : [];

  return {
    kind: obj.kind,
    title: coerceNullableString(obj.title),
    issuer: coerceNullableString(obj.issuer),
    dateOn: coerceNullableString(obj.dateOn),
    isCompleted: typeof obj.isCompleted === "boolean" ? obj.isCompleted : null,
    identifiers,
    summary: truncate(typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : "Document classified.", SUMMARY_MAX_CHARS),
    confidence: isConfidence(obj.confidence) ? obj.confidence : "low",
  };
}

async function cloudClassify(
  buffer: Buffer,
  mimeType: string,
  studentId: string,
): Promise<AttachmentClassification | null> {
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
              { text: CLOUD_PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  );
  if (!response.ok) {
    logger.warn("Cloud attachment classification failed", { status: response.status });
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

  if (!text.trim()) return null;
  try {
    return normalizeClassification(JSON.parse(text));
  } catch (error) {
    logger.warn("Cloud classification returned non-JSON", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Keyword heuristics for the no-consent path. Order matters — earlier kinds
// win, so the more specific signals are listed first.
const KIND_KEYWORDS: ReadonlyArray<{ kind: AttachmentKind; terms: ReadonlyArray<string> }> = [
  { kind: "certificate", terms: ["certificate of completion", "certification", "certificate", "credential", "is hereby awarded", "has completed"] },
  { kind: "transcript", terms: ["transcript", "grade report", "academic record"] },
  { kind: "resume", terms: ["work experience", "professional summary", "objective", "references available"] },
  { kind: "id_document", terms: ["driver's license", "state id", "identification card", "date of birth"] },
  { kind: "receipt", terms: ["receipt", "amount paid", "total due", "invoice"] },
  { kind: "letter", terms: ["dear ", "sincerely", "to whom it may concern"] },
  { kind: "form", terms: ["form", "signature", "please print", "applicant", "i certify that"] },
];

const COMPLETED_SIGNALS = ["awarded", "has completed", "completed on", "signed", "issued to", "date earned"];
const DATE_PATTERN =
  /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b/i;

/**
 * Best-effort local classification from extracted text. Never throws.
 * Exported for unit testing.
 */
export function classifyFromText(text: string): AttachmentClassification {
  const lower = text.toLowerCase();
  const kind = KIND_KEYWORDS.find((entry) => entry.terms.some((term) => lower.includes(term)))?.kind ?? "other";
  const dateMatch = text.match(DATE_PATTERN);
  const completed = COMPLETED_SIGNALS.some((s) => lower.includes(s)) ? true : null;

  return {
    kind,
    title: null,
    issuer: null,
    dateOn: dateMatch ? dateMatch[0] : null,
    isCompleted: completed,
    identifiers: [],
    summary: truncate(text, SUMMARY_MAX_CHARS) || "Document text extracted locally.",
    confidence: "low",
  };
}

export async function classifyAttachment(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  studentId: string;
  cloudAllowed: boolean;
}): Promise<ClassifyAttachmentResult> {
  const { buffer, filename, mimeType, studentId, cloudAllowed } = params;

  if (cloudAllowed) {
    try {
      const classification = await cloudClassify(buffer, mimeType, studentId);
      if (classification) return { classification, method: "cloud" };
    } catch (error) {
      logger.warn("Cloud classification threw; falling back to local extraction", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const extraction = await extractTextFromBuffer(buffer, extFromFilename(filename), {
    maxChars: 4000,
    maxPages: 3,
  });
  if (extraction?.text?.trim()) {
    return { classification: classifyFromText(extraction.text), method: "local" };
  }

  return {
    classification: {
      kind: "other",
      title: null,
      issuer: null,
      dateOn: null,
      isCompleted: null,
      identifiers: [],
      summary: cloudAllowed
        ? "Couldn't read this file's contents."
        : "Couldn't classify this file — cloud document processing is off for this student and no readable text was found (likely an image).",
      confidence: "low",
    },
    method: "none",
  };
}
