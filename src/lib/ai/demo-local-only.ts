import { isCohortDemoEnabled } from "@/lib/demo/config";

/** Deployment-wide: also covers unscoped background jobs and direct providers.
 * Keep COHORT_DEMO_LOCAL_ONLY=true when closing entry to drain pending demo work.
 * These switches never rewrite the normal provider or embedding configuration.
 */
export function isDemoLocalOnlyRequired(): boolean {
  return isCohortDemoEnabled() || process.env.VQ_MAC_RELAY_ENABLED === "true" ||
    process.env.COHORT_DEMO_LOCAL_ONLY?.trim().toLowerCase() === "true";
}

export function assertCloudInferenceAllowed(): void {
  if (isDemoLocalOnlyRequired()) {
    throw new Error("Local AI only: cloud inference is disabled for this demo deployment.");
  }
}

/** An Ollama cloud tag or hosted API is not local inference. */
export function assertLocalDemoTarget(url: string, model: string): void {
  if (!isDemoLocalOnlyRequired()) return;
  const target = new URL(url);
  const approved = process.env.COHORT_DEMO_LOCAL_AI_ORIGIN?.trim();
  if (!approved) {
    throw new Error("Local AI server is not configured for demo access: an approved endpoint origin is required.");
  }
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
  const host = target.hostname.toLowerCase();
  const hosted = ["ollama.com", "openrouter.ai", "openai.com", "googleapis.com", "anthropic.com"];
  if (/:.*cloud/i.test(model) || hosted.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Local AI only: a hosted model or cloud endpoint cannot serve this demo.");
  }
}
