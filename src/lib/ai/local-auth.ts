import type { LocalAIAuthConfig, LocalAIAuthMode } from "./types";

export const DEFAULT_LOCAL_AI_AUTH_MODE: LocalAIAuthMode = "none";

export function resolveLocalAiAuthMode(
  authMode: string | null | undefined,
): LocalAIAuthMode {
  switch (authMode) {
    case "bearer":
    case "cloudflare_service_token":
      return authMode;
    default:
      return DEFAULT_LOCAL_AI_AUTH_MODE;
  }
}

export function buildLocalAiHeaders(
  authConfig?: LocalAIAuthConfig | null,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const resolvedAuthConfig = authConfig ?? null;
  const headers: Record<string, string> = {
    "User-Agent": "VisionQuest",
    "ngrok-skip-browser-warning": "true",
    ...extraHeaders,
  };

  const authMode = resolvedAuthConfig?.authMode ?? DEFAULT_LOCAL_AI_AUTH_MODE;
  if (authMode === "bearer") {
    if (!resolvedAuthConfig?.apiKey) {
      throw new Error(
        "Local AI bearer token is not configured. Set it in Program Setup > AI Provider.",
      );
    }
    headers.Authorization = `Bearer ${resolvedAuthConfig.apiKey}`;
    return headers;
  }

  if (authMode === "cloudflare_service_token") {
    if (
      !resolvedAuthConfig?.cloudflareAccessClientId ||
      !resolvedAuthConfig.cloudflareAccessClientSecret
    ) {
      throw new Error(
        "Cloudflare Access service token is not configured. Set the client ID and client secret in Program Setup > AI Provider.",
      );
    }

    headers["CF-Access-Client-Id"] =
      resolvedAuthConfig.cloudflareAccessClientId;
    headers["CF-Access-Client-Secret"] =
      resolvedAuthConfig.cloudflareAccessClientSecret;
  }

  return headers;
}
