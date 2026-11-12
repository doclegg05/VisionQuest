import { isCohortDemoEnabled } from "@/lib/demo/config";

/**
 * The plain name for the block (H4). It does what the three older switches
 * do and nothing more: the block must outlive the demo, so it cannot rest on
 * a variable someone deletes when the demo closes.
 */
export const AI_LOCAL_ONLY_ENV = "AI_LOCAL_ONLY";

/**
 * The approved local endpoint origin, under its plain name and its demo name.
 * Either may be set. If both are, the endpoint must match both.
 */
const APPROVED_ORIGIN_ENVS = ["AI_LOCAL_APPROVED_ORIGIN", "COHORT_DEMO_LOCAL_AI_ORIGIN"] as const;

/** Deployment-wide: also covers unscoped background jobs and direct providers.
 * Keep AI_LOCAL_ONLY=true (or the older COHORT_DEMO_LOCAL_ONLY=true) when closing
 * demo entry, so pending work stays protected. In production, src/lib/boot-probes.ts
 * refuses to start unless one of these is on or cloud AI is allowed on purpose.
 * These switches never rewrite the normal provider or embedding configuration.
 */
export function isDemoLocalOnlyRequired(): boolean {
  return isCohortDemoEnabled() || process.env.VQ_MAC_RELAY_ENABLED === "true" ||
    process.env.COHORT_DEMO_LOCAL_ONLY?.trim().toLowerCase() === "true" ||
    process.env[AI_LOCAL_ONLY_ENV]?.trim().toLowerCase() === "true";
}

export function assertCloudInferenceAllowed(): void {
  if (isDemoLocalOnlyRequired()) {
    throw new Error("Local AI only: cloud inference is disabled for this demo deployment.");
  }
}

/** Every approved origin that is set, trimmed. A blank value counts as unset. */
function approvedOrigins(): string[] {
  return APPROVED_ORIGIN_ENVS.map((name) => process.env[name]?.trim() ?? "").filter((value) => value !== "");
}

function assertOriginApproves(approved: string, target: URL): void {
  let origin: URL;
  try {
    origin = new URL(approved);
  } catch {
    throw new Error("Local AI server approved endpoint origin is invalid.");
  }
  if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash || target.origin !== origin.origin) {
    throw new Error("Local AI server does not match the approved demo endpoint origin.");
  }
}

/** An Ollama cloud tag or hosted API is not local inference. */
export function assertLocalDemoTarget(url: string, model: string): void {
  if (!isDemoLocalOnlyRequired()) return;
  const target = new URL(url);
  const approved = approvedOrigins();
  if (approved.length === 0) {
    throw new Error("Local AI server is not configured for demo access: an approved endpoint origin is required.");
  }
  for (const origin of approved) assertOriginApproves(origin, target);
  const host = target.hostname.toLowerCase();
  const hosted = ["ollama.com", "openrouter.ai", "openai.com", "googleapis.com", "anthropic.com"];
  if (/:.*cloud/i.test(model) || hosted.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Local AI only: a hosted model or cloud endpoint cannot serve this demo.");
  }
}
