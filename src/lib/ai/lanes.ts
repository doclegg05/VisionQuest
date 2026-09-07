// src/lib/ai/lanes.ts
//
// AI LANES and the cloud policy switch (FERPA review 2026-09-06, Part 6 and
// Sprint 1 item 7).
//
// A lane is the disclosure class of a task's prompt content — what a cloud
// processor would receive if the call went there. It is deliberately a
// property of the TASK, not of the call site: `roleForTask` decides which
// local model serves a call, `laneForTask` decides whether the cloud may.
//
//   public    — program facts with no student content (form lookup, program
//               help). Never FERPA-covered.
//   coaching  — a student's or staff member's conversational turn and the
//               extractors that read it. The review's lane B: acceptable on a
//               contracted cloud processor once de-identified (Wave 2).
//   batch     — whole documents and long student-derived prose: résumé
//               bytes, uploaded attachments, endorsements. The review's
//               lane C: a zero-retention host or the local model only.
//   emotional — mood extraction, the summariser's "emotional state" reading,
//               crisis context. Never a cloud model, never state reporting,
//               whatever counsel rules on W. Va. Code 18-2-5h(e)(3).
//
// KNOWN GAP: nothing is `emotional` at task level yet. Mood extraction and
// the conversation summariser share `sage_post_response` /
// `conversation_summary` with goal, discovery and memory extraction —
// post-response resolves ONE provider for four extractors — so the task
// union cannot name them separately today. Splitting that is owner decision
// D-J plus a post-response restructure, both outside this module.

import { getPlainConfigValue, type SystemConfigKey } from "@/lib/system-config";
import { logger } from "@/lib/logger";
import { logAiAuditEvent } from "@/lib/ai/audit";
import type { AiTask, DataSensitivity } from "./types";

export type AiLane = "public" | "coaching" | "batch" | "emotional";

/**
 * Total over `AiTask` on purpose — the `roles.ts` precedent. A task added to
 * the union without a lane is a type error, never a silent fallthrough to
 * "may go cloud".
 */
export const TASK_LANES: Record<AiTask, AiLane> = {
  public_form_lookup: "public",
  public_program_help: "public",

  sage_student_chat: "coaching",
  sage_staff_chat: "coaching",
  sage_post_response: "coaching",
  sage_briefing: "coaching",
  conversation_summary: "coaching",
  tailor_application: "coaching",
  explain_job: "coaching",
  legacy: "coaching",
  // The raw chat message and every stored memory, embedded on every turn.
  // Coaching content, coaching lane; a real vector API call rather than a
  // generative one, so it has no role in roles.ts.
  embedding: "coaching",

  resume_assist: "batch",
  resume_extract: "batch",
  draft_endorsement: "batch",
  chat_file_gist: "batch",
};

export function laneForTask(task: AiTask): AiLane {
  return TASK_LANES[task];
}

// ---------------------------------------------------------------------------
// The policy switch
// ---------------------------------------------------------------------------

export const AI_CLOUD_POLICIES = ["permissive", "lanes", "local_only"] as const;
export type AiCloudPolicy = (typeof AI_CLOUD_POLICIES)[number];

/**
 * `permissive` is exactly the routing that shipped before this switch
 * existed: `ai_provider` alone decides, and no task or sensitivity ever
 * refuses the cloud provider. Production runs here today.
 */
export const DEFAULT_AI_CLOUD_POLICY: AiCloudPolicy = "permissive";

/**
 * SystemConfig key. NOT yet a member of `SYSTEM_CONFIG_KEYS` in
 * src/lib/system-config.ts (outside this change's file fence), so the admin
 * settings surface cannot set it and `isValidConfigKey` rejects it; until that
 * one-line addition lands the switch is set through the `AI_CLOUD_POLICY`
 * env var. The cast is what lets the read compile meanwhile — remove it when
 * the key is registered.
 */
export const AI_CLOUD_POLICY_CONFIG_KEY = "ai_cloud_policy" as SystemConfigKey;
export const AI_CLOUD_POLICY_ENV = "AI_CLOUD_POLICY";

export function isAiCloudPolicy(value: string): value is AiCloudPolicy {
  return (AI_CLOUD_POLICIES as readonly string[]).includes(value);
}

/**
 * Parse a raw config/env value. Unset is the default and not an error;
 * anything else unrecognised is ALSO the default, but `recognized: false`
 * lets the reader warn once rather than silently running permissive on a
 * typo like "local-only".
 */
export function parseAiCloudPolicy(
  raw: string | null | undefined,
): { policy: AiCloudPolicy; recognized: boolean } {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "") return { policy: DEFAULT_AI_CLOUD_POLICY, recognized: true };
  if (isAiCloudPolicy(normalized)) return { policy: normalized, recognized: true };
  return { policy: DEFAULT_AI_CLOUD_POLICY, recognized: false };
}

// One warning per process per unrecognised value: this is read on every
// cloud resolution, and a log line per Sage turn would bury the signal.
const warnedUnknownPolicyValues = new Set<string>();

/** SystemConfig `ai_cloud_policy`, then env `AI_CLOUD_POLICY`, then the default. */
export async function readAiCloudPolicy(): Promise<AiCloudPolicy> {
  const configured = await getPlainConfigValue(AI_CLOUD_POLICY_CONFIG_KEY);
  const raw = configured?.trim() ? configured : process.env[AI_CLOUD_POLICY_ENV] ?? null;
  const { policy, recognized } = parseAiCloudPolicy(raw);
  if (!recognized && raw !== null && !warnedUnknownPolicyValues.has(raw)) {
    warnedUnknownPolicyValues.add(raw);
    // No student data here by construction: the payload is the operator's
    // config value and the allowed list.
    logger.warn("Unknown ai_cloud_policy value; running permissive", {
      value: raw,
      allowed: [...AI_CLOUD_POLICIES],
    });
  }
  return policy;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** The two sensitivities the FERPA rule marks local-only. */
export function isLocalOnlySensitivity(sensitivity: DataSensitivity): boolean {
  return sensitivity === "student_record" || sensitivity === "staff_entered";
}

/**
 * Why a cloud resolution is refused under `policy`, or `null` when it is
 * allowed. Pure: no config, no I/O, so the decision table is testable on
 * its own.
 *
 *  - permissive: never refuses.
 *  - lanes: the `batch` and `emotional` lanes refuse; `coaching` and
 *    `public` may go cloud.
 *  - local_only: everything `lanes` refuses, plus any call whose sensitivity
 *    is local-only, whatever its lane. Strictly a superset of `lanes`, so an
 *    operator moving from one to the other never loosens anything.
 */
export function cloudRefusalReason(
  policy: AiCloudPolicy,
  task: AiTask,
  sensitivity: DataSensitivity,
): string | null {
  if (policy === "permissive") return null;
  const lane = laneForTask(task);
  if (lane === "batch" || lane === "emotional") {
    return `ai_cloud_policy=${policy}: the ${lane} lane never goes to a cloud model.`;
  }
  if (policy === "local_only" && isLocalOnlySensitivity(sensitivity)) {
    return `ai_cloud_policy=local_only: ${sensitivity} prompts never go to a cloud model.`;
  }
  return null;
}

/**
 * Thrown by the resolvers when the cloud provider would have served a call
 * the policy refuses. Callers already map a resolver throw to a 503 with the
 * 988 block (the chat route) or a refusal (endorsement, résumé assist); this
 * class lets them tell a policy refusal from a misconfigured local server.
 */
export class AiCloudRefusedError extends Error {
  readonly task: AiTask;
  readonly sensitivity: DataSensitivity;
  readonly lane: AiLane;
  readonly policy: AiCloudPolicy;

  constructor(input: {
    task: AiTask;
    sensitivity: DataSensitivity;
    lane: AiLane;
    policy: AiCloudPolicy;
    reason: string;
  }) {
    super(input.reason);
    this.name = "AiCloudRefusedError";
    this.task = input.task;
    this.sensitivity = input.sensitivity;
    this.lane = input.lane;
    this.policy = input.policy;
  }
}

export interface CloudPolicySubject {
  /** The student the call is about; null for system calls with no student. */
  studentId: string | null;
  task: AiTask;
  sensitivity: DataSensitivity;
}

/**
 * Read the policy and apply it to one prospective CLOUD resolution.
 *
 * Returns the policy when the call may proceed. When it may not, writes a
 * `blocked` AI audit event FIRST (the accountability report and the
 * `ferpa-routing` benchmark read AuditLog; a refusal nobody can see is not
 * a control) and then throws `AiCloudRefusedError`. Local resolutions never
 * come through here — the policy governs the cloud, not the local model.
 */
export async function enforceCloudPolicy(
  subject: CloudPolicySubject,
  route = "ai.resolve",
): Promise<AiCloudPolicy> {
  const policy = await readAiCloudPolicy();
  const reason = cloudRefusalReason(policy, subject.task, subject.sensitivity);
  if (reason === null) return policy;

  const lane = laneForTask(subject.task);
  await logAiAuditEvent({
    actorId: subject.studentId,
    actorRole: null,
    route,
    task: subject.task,
    sensitivity: subject.sensitivity,
    policyDecision: "blocked",
    status: "blocked",
    targetId: subject.studentId,
    providerName: null,
    providerClass: "none",
    allowCloud: false,
    reason,
    errorCode: "AI_CLOUD_REFUSED",
    metadata: { lane, policy, refusedProviderClass: "cloud" },
  });

  throw new AiCloudRefusedError({
    task: subject.task,
    sensitivity: subject.sensitivity,
    lane,
    policy,
    reason,
  });
}
