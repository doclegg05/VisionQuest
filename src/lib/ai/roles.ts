// src/lib/ai/roles.ts
//
// AI ROLES — the distinct jobs VisionQuest asks a *generative* model to do.
//
// Until this module existed, every generative call — a student's coaching
// turn, a background goal extraction, a resume parse, a nightly briefing —
// went to the single model named by SystemConfig `ai_provider_model`. That is
// fine for a cloud provider (Gemini is one model that does everything well)
// but wrong for a local one: the jobs below have genuinely different
// capability profiles, and the local model that is best at one is measurably
// not best at another. See `docs/plans/2026-08-21-local-ai-role-models.md`.
//
// A role is a *capability profile*, not a call site. Two call sites share a
// role when the same model property decides whether they succeed.

import type { AiTask } from "./types";

export const AI_ROLES = ["chat", "extract", "document", "draft"] as const;

export type AiRole = (typeof AI_ROLES)[number];

export function isAiRole(value: string): value is AiRole {
  return (AI_ROLES as readonly string[]).includes(value);
}

/**
 * SystemConfig key holding the model override for each role. Unset (the
 * default) means "use `ai_provider_model`" — i.e. exactly today's behavior.
 */
export const AI_ROLE_MODEL_CONFIG_KEYS = {
  chat: "ai_provider_model_chat",
  extract: "ai_provider_model_extract",
  document: "ai_provider_model_document",
  draft: "ai_provider_model_draft",
} as const satisfies Record<AiRole, string>;

export type AiRoleModelConfigKey =
  (typeof AI_ROLE_MODEL_CONFIG_KEYS)[AiRole];

/**
 * SystemConfig key holding the per-role output-token cap.
 *
 * Choosing a model for a role is only half the job — the role also has to be
 * given room to answer. Today one global cap covers every role (768 tokens
 * free-text / 512 structured), and two roles provably do not fit inside it:
 * the career-discovery schema (6 string arrays + 9 cluster scores + 6 RIASEC
 * scores + 14 clusters + two prose summaries) and the resume parse (a whole
 * resume object) are both larger than 512 tokens of JSON, and a truncated
 * JSON parse is indistinguishable from "the student said nothing".
 *
 * Unset → the provider's existing defaults, unchanged. Raising a cap costs
 * latency, so it stays an explicit operator decision rather than a new
 * default. Recommended starting values are in
 * docs/plans/2026-08-21-local-ai-role-models.md.
 */
export const AI_ROLE_MAX_OUTPUT_CONFIG_KEYS = {
  chat: "ai_provider_max_output_tokens_chat",
  extract: "ai_provider_max_output_tokens_extract",
  document: "ai_provider_max_output_tokens_document",
  draft: "ai_provider_max_output_tokens_draft",
} as const satisfies Record<AiRole, string>;

export interface AiRoleProfile {
  role: AiRole;
  /** Operator-facing name, used by the admin surface and the bake-off report. */
  label: string;
  /**
   * The single model property that decides success or failure here. This is
   * what a bake-off must actually score for this role — not general
   * "quality". Each is grounded in a failure this repo has observed.
   */
  discriminator: string;
  /** What the caller does with the bytes the model returns. */
  outputContract: "stream_with_tools" | "strict_json" | "prose";
  /** Whether a human is waiting on this call. */
  latency: "interactive" | "background";
}

export const AI_ROLE_PROFILES: Record<AiRole, AiRoleProfile> = {
  chat: {
    role: "chat",
    label: "Coaching chat",
    discriminator:
      "Tool-call reliability against the ~20k-char Sage prompt, plus reply prose at the student reading level. A model that drops or malforms a tool call returns an empty turn rather than an error (see the undeclared-tool drop in .claude/MEMORY.md).",
    outputContract: "stream_with_tools",
    latency: "interactive",
  },
  extract: {
    role: "extract",
    label: "Transcript extraction",
    discriminator:
      "Conformance to JSON output mode on short transcript inputs. Failures here are silent: memory extraction stored 0 memories with zero errors on the local path because json_object mode cannot emit the bare array the prompt asked for.",
    outputContract: "strict_json",
    latency: "background",
  },
  document: {
    role: "document",
    label: "Document understanding",
    discriminator:
      "Holding a long, messy document (a resume, an uploaded attachment) in context and still emitting conforming JSON. Long-input degradation, not reasoning, is what breaks this role.",
    outputContract: "strict_json",
    latency: "interactive",
  },
  draft: {
    role: "draft",
    label: "Long-form drafting",
    discriminator:
      "Sustained, non-repetitive prose a person will read and act on — resume bullets, a tailored application, a nightly briefing. Output-length headroom matters more than tool use or strict formatting.",
    outputContract: "prose",
    latency: "background",
  },
};

/**
 * Which role each declared `AiTask` belongs to.
 *
 * `null` means "no role-specific model" — the global `ai_provider_model` is
 * used, which is exactly the behavior every call site had before roles
 * existed. That is the deliberate fail-safe direction: a task that is not
 * classified must never silently pick up a model an operator tuned for
 * something else.
 *
 * Total over `AiTask` on purpose — adding a task to the union without
 * deciding its role is a type error, not a silent fallthrough.
 */
const TASK_ROLES: Record<AiTask, AiRole | null> = {
  // Unclassified legacy call sites keep the global model.
  legacy: null,
  // Deterministic form-registry match — logged for audit, never resolves a
  // provider (policyDecision "direct_no_model" in /api/chat/send). Listed
  // for totality; the value is unreachable.
  public_form_lookup: null,

  sage_student_chat: "chat",
  sage_staff_chat: "chat",
  public_program_help: "chat",

  // Goals, career discovery, mood, classroom confirmation, student and staff
  // memory — all strict JSON over a recent-transcript window.
  sage_post_response: "extract",

  resume_extract: "document",
  chat_file_gist: "document",

  sage_briefing: "draft",
  conversation_summary: "draft",
  resume_assist: "draft",
  tailor_application: "draft",
};

export function roleForTask(task: AiTask): AiRole | null {
  return TASK_ROLES[task] ?? null;
}

/**
 * Do two model tags name the same loaded model?
 *
 * Ollama resolves a bare name to its `:latest` tag, so "gemma4" and
 * "gemma4:latest" are one model on the server even though the strings differ.
 * That matters for the residency rule: `keep_alive` is applied by the server
 * PER MODEL, so treating an alias of the chat model as "a different model"
 * would attach the short keep-alive to the very model students are waiting on
 * and cut its residency to minutes.
 *
 * Deliberately not a prefix match — "gemma4:12" is a typo for "gemma4:12b",
 * not an alias of it.
 */
export function isSameModelTag(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const canonical = (tag: string) => (tag.includes(":") ? tag : `${tag}:latest`);
  return canonical(left) === canonical(right);
}
