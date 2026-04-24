import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { AiTask, DataSensitivity, PromptTier } from "./types";

export type AiPolicyDecision =
  | "local_only"
  | "direct_no_model"
  | "cloud_allowed"
  | "configured_provider"
  | "blocked";

export type AiAuditStatus = "routed" | "completed" | "blocked" | "failed" | "direct";

export interface AiAuditEventInput {
  actorId?: string | null;
  actorRole?: string | null;
  route: string;
  task: AiTask;
  sensitivity: DataSensitivity;
  policyDecision: AiPolicyDecision;
  status: AiAuditStatus;
  targetId?: string | null;
  providerName?: string | null;
  providerClass?: "local" | "cloud" | "none" | "unknown";
  promptTier?: PromptTier | null;
  allowCloud: boolean;
  inputChars?: number;
  outputChars?: number;
  reason?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

function actionForStatus(status: AiAuditStatus) {
  switch (status) {
    case "completed":
      return "ai.request.completed";
    case "blocked":
      return "ai.request.blocked";
    case "failed":
      return "ai.request.failed";
    case "direct":
      return "ai.request.direct";
    default:
      return "ai.request.routed";
  }
}

export function getProviderClass(providerName?: string | null): "local" | "cloud" | "none" | "unknown" {
  if (!providerName) return "none";
  if (providerName === "ollama") return "local";
  if (providerName === "gemini") return "cloud";
  return "unknown";
}

export async function logAiAuditEvent(input: AiAuditEventInput): Promise<void> {
  try {
    await logAuditEvent({
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: actionForStatus(input.status),
      targetType: "ai_request",
      targetId: input.targetId ?? null,
      summary:
        input.status === "direct"
          ? `AI bypassed by policy for ${input.task}; no model received the request.`
          : `AI ${input.status} for ${input.task} via ${input.providerName || "no provider"}.`,
      metadata: {
        route: input.route,
        task: input.task,
        sensitivity: input.sensitivity,
        policyDecision: input.policyDecision,
        status: input.status,
        providerName: input.providerName ?? null,
        providerClass: input.providerClass ?? getProviderClass(input.providerName),
        promptTier: input.promptTier ?? null,
        allowCloud: input.allowCloud,
        cloudBlocked:
          input.status === "blocked" ||
          (input.allowCloud === false && input.providerClass !== "cloud"),
        inputChars: input.inputChars ?? null,
        outputChars: input.outputChars ?? null,
        reason: input.reason ?? null,
        errorCode: input.errorCode ?? null,
        contentLogged: false,
        piiLogged: false,
        ...input.metadata,
      },
    });
  } catch (error) {
    logger.warn("AI audit event could not be written", {
      task: input.task,
      status: input.status,
      error: String(error),
    });
  }
}
