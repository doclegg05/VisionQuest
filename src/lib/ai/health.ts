export interface HealthResult {
  healthy: boolean;
  models?: string[];
  error?: string;
  apiMode?: "openai" | "native";
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VisionQuest",
        "ngrok-skip-browser-warning": "true",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOllamaHealth(
  baseUrl: string,
  timeoutMs: number = 2000,
): Promise<HealthResult> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  try {
    const tagsResponse = await fetchWithTimeout(
      `${normalizedBaseUrl}/api/tags`,
      timeoutMs,
    );

    if (tagsResponse.ok) {
      const data = await tagsResponse.json();
      const models = Array.isArray(data.models)
        ? data.models
            .map((m: { name?: string }) => m.name)
            .filter((name: string | undefined): name is string => typeof name === "string")
        : [];

      const openAICompatibility = await fetchWithTimeout(
        `${normalizedBaseUrl}/v1/models`,
        timeoutMs,
      ).catch(() => null);

      return {
        healthy: true,
        models,
        apiMode: openAICompatibility?.ok ? "openai" : "native",
      };
    }

    const openAIResponse = await fetchWithTimeout(
      `${normalizedBaseUrl}/v1/models`,
      timeoutMs,
    );
    if (!openAIResponse.ok) {
      return { healthy: false, error: `Server returned ${tagsResponse.status}` };
    }

    const data = await openAIResponse.json();
    const models = Array.isArray(data.data)
      ? data.data
          .map((m: { id?: string }) => m.id)
          .filter((id: string | undefined): id is string => typeof id === "string")
      : [];

    return { healthy: true, models, apiMode: "openai" };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
