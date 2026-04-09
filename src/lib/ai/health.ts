export interface HealthResult {
  healthy: boolean;
  models?: string[];
  error?: string;
}

export async function checkOllamaHealth(
  baseUrl: string,
  timeoutMs: number = 2000,
): Promise<HealthResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VisionQuest",
        "ngrok-skip-browser-warning": "true",
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { healthy: false, error: `Server returned ${res.status}` };
    }

    const data = await res.json();
    const models = Array.isArray(data.models)
      ? data.models.map((m: { name: string }) => m.name)
      : [];

    return { healthy: true, models };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
