/**
 * O*NET Web Services credentials — Interest Profiler only.
 * Env keys (never log values): ONET_USERNAME, ONET_PASSWORD, ONET_API_KEY.
 * Supports HTTP Basic (ONET_USERNAME + ONET_PASSWORD/ONET_API_KEY) or single ONET_API_KEY.
 */

export interface OnetCredentials {
  username: string;
  password: string;
  apiKey?: string;
}

export function onetCredentials(): OnetCredentials | null {
  const username = process.env.ONET_USERNAME;
  const password = process.env.ONET_PASSWORD || process.env.ONET_API_KEY;
  const apiKey = process.env.ONET_API_KEY;

  const effectiveUsername = username || apiKey;
  const effectivePassword = password || apiKey;

  if (!effectiveUsername || !effectivePassword) return null;

  return {
    username: effectiveUsername,
    password: effectivePassword,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function isOnetConfigured(): boolean {
  return onetCredentials() !== null;
}

