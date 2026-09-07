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
 * Routing mirrors file-gist: the recorded-consent decision (2026-06-09)
 * first, then the AI routing rules, then a local structured step, then
 * keyword heuristics (Task B):
 * - WITH active cloud_file_processing consent: the provider is resolved
 *   through `resolveAiProvider` (`chat_file_gist`, `student_record`) and only
 *   a provider that implements `describeDocument` (Gemini) receives the bytes
 *   (inline_data transport — same cloud boundary as the gist path). A local
 *   provider has no such method, so the cloud pass declines.
 * - WITHOUT consent (or the cloud pass declined/failed): if the resolved
 *   provider is the local one, extracted text is classified with
 *   generateStructuredResponse against the same schema shape as the cloud
 *   pass. Text never goes to a cloud provider from this step.
 * - Otherwise (no local provider, or the local pass didn't parse): keyword
 *   heuristics. Image-only files with no readable text fall through to
 *   method "none".
 * Every routing decision writes an AI audit event (routed / completed /
 * failed / blocked); until 2026-09 this file wrote none and posted the bytes
 * to Gemini by raw fetch, bypassing the resolver (FERPA review, Known Issues).
 */

import { z } from "zod";
import { extractTextFromBuffer } from "./extract";
import { logger } from "@/lib/logger";
import { logLlmCall } from "@/lib/llm-usage";
import { resolveAiProvider } from "@/lib/ai";
import { AiCloudRefusedError } from "@/lib/ai/lanes";
import {
  getProviderClass,
  logAiAuditEvent,
  policyDecisionForProvider,
} from "@/lib/ai/audit";
import type { AIProvider, TokenUsage } from "@/lib/ai/types";

const INLINE_CLOUD_LIMIT_BYTES = 15 * 1024 * 1024; // inline_data request ceiling
const SUMMARY_MAX_CHARS = 400;
/** Cap on extracted text sent to the local structured-classification prompt. */
const LOCAL_CLASSIFY_MAX_CHARS = 4000;

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
  /**
   * Which path produced the result — recorded for the AI audit trail.
   * "local_structured": a locally-configured AI provider (ollama) produced
   * a schema-validated JSON classification. "local": the keyword-heuristic
   * fallback (classifyFromText) — kept distinct so the audit trail can tell
   * a real local model pass from a plain string-match guess.
   */
  method: "cloud" | "local_structured" | "local" | "none";
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

type ClassifyAuditBase = {
  actorId: string;
  actorRole: string;
  targetId: string;
  route: string;
  task: "chat_file_gist";
  sensitivity: "student_record";
  policyDecision: ReturnType<typeof policyDecisionForProvider>;
  providerName: string;
  providerClass: ReturnType<typeof getProviderClass>;
};

function auditBaseFor(provider: AIProvider, studentId: string): ClassifyAuditBase {
  return {
    actorId: studentId,
    actorRole: "student",
    targetId: studentId,
    route: "sage.classify_attachment",
    task: "chat_file_gist",
    sensitivity: "student_record",
    policyDecision: policyDecisionForProvider(provider.name),
    providerName: provider.name,
    providerClass: getProviderClass(provider.name),
  };
}

function providerModel(provider: AIProvider): string {
  return (provider as { model?: string }).model?.trim() || provider.name;
}

/**
 * Resolve the provider for this student's chat_file_gist task once per
 * call. Returns null (never throws) when the policy refuses the cloud — the
 * resolver already wrote the blocked audit event — or when resolution fails
 * for any other reason, so the caller can fall through to keyword heuristics.
 */
async function resolveClassifier(studentId: string): Promise<AIProvider | null> {
  try {
    return await resolveAiProvider({
      studentId,
      task: "chat_file_gist",
      sensitivity: "student_record",
    });
  } catch (error) {
    if (error instanceof AiCloudRefusedError) return null;
    logger.warn("Classification provider resolution failed; falling back", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cloud document understanding over the raw bytes. Only a provider that
 * implements `describeDocument` is eligible; a local provider declines here
 * (audited as blocked) and the caller runs the local pass on the same
 * provider instead. Throws only when the provider call itself fails.
 */
async function cloudClassify(
  provider: AIProvider,
  buffer: Buffer,
  mimeType: string,
  studentId: string,
): Promise<AttachmentClassification | null> {
  if (buffer.length > INLINE_CLOUD_LIMIT_BYTES) return null;
  const auditBase = auditBaseFor(provider, studentId);

  if (!provider.describeDocument) {
    await logAiAuditEvent({
      ...auditBase,
      status: "blocked",
      allowCloud: false,
      reason: "The resolved provider cannot read document bytes; local classification only.",
      errorCode: "NO_DOCUMENT_CAPABILITY",
    });
    return null;
  }

  const allowCloud = auditBase.providerClass === "cloud";
  await logAiAuditEvent({ ...auditBase, status: "routed", allowCloud, inputChars: buffer.length });

  const startedAt = Date.now();
  // Collected rather than assigned — see the same note in file-gist.ts.
  const usages: TokenUsage[] = [];
  let text: string;
  try {
    text = await provider.describeDocument(buffer, mimeType, CLOUD_PROMPT, {
      responseFormat: "json",
      responseSchema: RESPONSE_SCHEMA,
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

  if (!text.trim()) {
    await logAiAuditEvent({ ...auditBase, status: "failed", allowCloud, errorCode: "empty_reply" });
    return null;
  }
  try {
    const classification = normalizeClassification(JSON.parse(text));
    await logAiAuditEvent({
      ...auditBase,
      status: classification ? "completed" : "failed",
      allowCloud,
      inputChars: buffer.length,
      outputChars: classification?.summary.length,
      ...(classification ? {} : { errorCode: "unparseable_classification" }),
    });
    return classification;
  } catch (error) {
    logger.warn("Cloud classification returned non-JSON", {
      error: error instanceof Error ? error.message : String(error),
    });
    await logAiAuditEvent({ ...auditBase, status: "failed", allowCloud, errorCode: "non_json_reply" });
    return null;
  }
}

// zod mirror of AttachmentClassification, used to validate the local
// provider's JSON before trusting it. Mirrors cloudClassify's RESPONSE_SCHEMA
// shape/required fields; normalizeClassification (used for the cloud path)
// is intentionally permissive, so structured validation here is what makes
// the local path safe to trust without a second normalization pass.
const LOCAL_CLASSIFICATION_SCHEMA = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  title: z.string().trim().min(1).nullable().optional(),
  issuer: z.string().trim().min(1).nullable().optional(),
  dateOn: z.string().trim().min(1).nullable().optional(),
  isCompleted: z.boolean().nullable().optional(),
  identifiers: z.array(z.string()).optional(),
  summary: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

const LOCAL_CLASSIFY_PROMPT =
  "You are classifying a document a workforce-development student uploaded in chat. " +
  "You are given the document's extracted text, not the original file. " +
  "Identify what it is and extract key fields. Respond ONLY with JSON matching the schema. " +
  "kind: certificate | form | resume | id_document | transcript | letter | receipt | photo | other. " +
  "title: the credential/form/document name or null. " +
  "issuer: the issuing organization/authority or null. " +
  "dateOn: a date earned/issued exactly as printed, or null. " +
  "isCompleted: true if a certificate looks awarded or a form looks signed/filled, false if blank/unsigned, null if unclear. " +
  "identifiers: array of form numbers / certificate IDs found (empty array if none). " +
  "summary: at most 60 words, plain text. " +
  "confidence: high | medium | low. " +
  'Respond with a single JSON object only, e.g. {"kind":"form","title":null,"issuer":null,"dateOn":null,"isCompleted":null,"identifiers":[],"summary":"...","confidence":"low"}';

/**
 * Local structured classification from extracted document text, using the
 * provider already resolved for this student's chat_file_gist task. Only
 * proceeds when that provider is the local ("ollama") one — never sends text
 * to a cloud provider from this path, since that would bypass the consent
 * gate that the cloud pass enforces; the refusal is audited as blocked
 * rather than silent. Returns null (never throws) on any request or
 * validation failure so the caller can fall through to keyword heuristics.
 */
async function localClassify(
  provider: AIProvider,
  text: string,
  studentId: string,
): Promise<AttachmentClassification | null> {
  if (!text.trim()) return null;
  const auditBase = auditBaseFor(provider, studentId);

  // Only a configured local provider is eligible — never route this
  // extracted text through a cloud provider outside the consent gate.
  if (provider.name !== "ollama") {
    await logAiAuditEvent({
      ...auditBase,
      status: "blocked",
      allowCloud: false,
      reason: "Local structured classification is local-only; the resolved provider was not local.",
    });
    return null;
  }

  await logAiAuditEvent({ ...auditBase, status: "routed", allowCloud: false, inputChars: text.length });

  try {
    const raw = await provider.generateStructuredResponse(LOCAL_CLASSIFY_PROMPT, [
      { role: "user", content: truncate(text, LOCAL_CLASSIFY_MAX_CHARS) },
    ]);
    if (!raw.trim()) {
      await logAiAuditEvent({ ...auditBase, status: "failed", allowCloud: false, errorCode: "empty_reply" });
      return null;
    }

    const parsed = LOCAL_CLASSIFICATION_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn("Local classification failed schema validation; falling back", {
        error: parsed.error.message,
      });
      await logAiAuditEvent({
        ...auditBase,
        status: "failed",
        allowCloud: false,
        errorCode: "schema_validation",
      });
      return null;
    }

    const classification = normalizeClassification(parsed.data);
    await logAiAuditEvent({
      ...auditBase,
      status: "completed",
      allowCloud: false,
      inputChars: text.length,
      outputChars: classification?.summary.length,
    });
    return classification;
  } catch (error) {
    logger.warn("Local classification threw; falling back to keyword heuristics", {
      error: error instanceof Error ? error.message : String(error),
    });
    await logAiAuditEvent({
      ...auditBase,
      status: "failed",
      allowCloud: false,
      errorCode: "provider_error",
      reason: String(error).slice(0, 200),
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

  // One resolution per call. `undefined` = not attempted yet; `null` = the
  // resolver refused or failed, so no model pass runs at all.
  let provider: AIProvider | null | undefined;

  if (cloudAllowed) {
    provider = await resolveClassifier(studentId);
    if (provider) {
      try {
        const classification = await cloudClassify(provider, buffer, mimeType, studentId);
        if (classification) return { classification, method: "cloud" };
      } catch (error) {
        logger.warn("Cloud classification threw; falling back to local extraction", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const extraction = await extractTextFromBuffer(buffer, extFromFilename(filename), {
    maxChars: 4000,
    maxPages: 3,
  });

  if (extraction?.text?.trim()) {
    if (provider === undefined) provider = await resolveClassifier(studentId);
    const localStructured = provider
      ? await localClassify(provider, extraction.text, studentId)
      : null;
    if (localStructured) {
      return { classification: localStructured, method: "local_structured" };
    }

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
