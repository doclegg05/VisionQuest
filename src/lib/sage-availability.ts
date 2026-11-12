import { cached } from "./cache";
import { logger } from "./logger";
import { getConfigValue, getPlainConfigValue } from "./system-config";
import { GEMINI_MODEL } from "./gemini";
import { readLocalAiProviderConfig, toLocalAiAuthConfig } from "./ai/local-config";
import { buildLocalAiHeaders } from "./ai/local-auth";
import { isDemoLocalOnlyRequired, assertLocalDemoTarget } from "./ai/demo-local-only";
import { isSafeAiProviderUrl } from "./validation";
import { pinnedLocalModel } from "./ai/local-model";

export interface SageAvailability { connected: boolean; checkedAt: string }

/** One alarm per observed outage, after five minutes; recovery starts a new window. */
export function createAvailabilityMonitor(now = Date.now, alarm = () => logger.error("Sage connection is unavailable", { alert: "sage_disconnected" })) {
  let failedSince: number | null = null;
  let alerted = false;
  return (connected: boolean): SageAvailability => {
    const time = now();
    if (connected) { failedSince = null; alerted = false; }
    else {
      failedSince ??= time;
      if (!alerted && time - failedSince >= 300_000) { alerted = true; alarm(); }
    }
    return { connected, checkedAt: new Date(time).toISOString() };
  };
}

/** Connection/model discovery only: never generates a reply or sends student data. */
async function probeConnection(): Promise<boolean> {
  const options = { signal: AbortSignal.timeout(2500), redirect: "error" as const, cache: "no-store" as const };
  if (process.env.VQ_MAC_RELAY_ENABLED === "true") {
    const response = await fetch("http://127.0.0.1:11437/health", options);
    return response.ok && (await response.json()).connected === true;
  }
  if (isDemoLocalOnlyRequired() || await getPlainConfigValue("ai_provider") === "local") {
    const config = await readLocalAiProviderConfig();
    if (!config.url || !isSafeAiProviderUrl(config.url)) return false;
    const model = pinnedLocalModel();
    assertLocalDemoTarget(config.url, model);
    const openai = config.apiStyle === "openai";
    const response = await fetch(`${config.url.replace(/\/+$/, "")}${openai ? "/v1/models" : "/api/tags"}`, {
      ...options, headers: buildLocalAiHeaders(toLocalAiAuthConfig(config)),
    });
    if (!response.ok) return false;
    const body = await response.json();
    const models: unknown = openai ? body.data : body.models;
    return Array.isArray(models) && models.some((entry) => (openai ? entry?.id : entry?.name) === model);
  }
  const key = await getConfigValue("gemini_api_key") || process.env.GEMINI_API_KEY;
  if (!key) return false;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}`, {
    ...options, headers: { "x-goog-api-key": key },
  });
  return response.ok;
}

const observe = createAvailabilityMonitor();

/** Public result contains only a connection flag and its check time. */
export function getSageAvailability(): Promise<SageAvailability> {
  return cached("sage:availability", 60, async () => {
    try { return observe(await probeConnection()); }
    catch { return observe(false); }
  });
}
