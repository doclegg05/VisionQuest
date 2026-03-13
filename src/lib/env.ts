/**
 * Environment variable validation — imported at app startup.
 * Throws immediately if a required variable is missing or malformed so deploys fail fast.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example for the full list.`
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function assertNoSurroundingQuotes(name: string, value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    throw new Error(
      `${name} appears to include surrounding quotes. ` +
        `If you are setting this in the Render dashboard, paste the raw value without quotes.`
    );
  }
}

function assertUrlLike(name: string, value: string, protocols: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of these protocols: ${protocols.join(", ")}.`);
  }
}

function assertBase64Key(name: string, value: string, bytes: number) {
  assertNoSurroundingQuotes(name, value);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes) {
    throw new Error(`${name} must be a base64-encoded ${bytes}-byte value.`);
  }
}

function assertMinLength(name: string, value: string, minLength: number) {
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long.`);
  }
}

function validateDatabaseUrl(name: string, value: string) {
  assertNoSurroundingQuotes(name, value);
  assertUrlLike(name, value, ["postgresql:", "postgres:"]);
}

function validateAppBaseUrl(value: string) {
  assertNoSurroundingQuotes("APP_BASE_URL", value);
  assertUrlLike("APP_BASE_URL", value, ["https:", "http:"]);
}

function validateGoogleRedirectUri(value?: string) {
  if (!value) return;
  assertNoSurroundingQuotes("GOOGLE_REDIRECT_URI", value);
  assertUrlLike("GOOGLE_REDIRECT_URI", value, ["https:", "http:"]);
}

function validateSmtpPort(value?: string) {
  if (!value) return;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive integer.");
  }
}

export const env = {
  // Database
  DATABASE_URL: required("DATABASE_URL"),
  DIRECT_URL: optional("DIRECT_URL"),

  // Auth (always required)
  JWT_SECRET: required("JWT_SECRET"),
  API_KEY_ENCRYPTION_KEY: required("API_KEY_ENCRYPTION_KEY"),
  APP_BASE_URL: required("APP_BASE_URL"),

  // Gemini (required for Sage to work)
  GEMINI_API_KEY: optional("GEMINI_API_KEY"),

  // Cloudflare R2 (optional — falls back to local uploads/)
  R2_ACCOUNT_ID: optional("R2_ACCOUNT_ID"),
  R2_ACCESS_KEY: optional("R2_ACCESS_KEY"),
  R2_SECRET_KEY: optional("R2_SECRET_KEY"),
  R2_BUCKET_NAME: optional("R2_BUCKET_NAME"),

  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
  GOOGLE_REDIRECT_URI: optional("GOOGLE_REDIRECT_URI"),

  // Email (optional — password reset disabled without it)
  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: optional("SMTP_PORT"),
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  SMTP_FROM: optional("SMTP_FROM"),

  // Internal cron protection
  CRON_SECRET: optional("CRON_SECRET"),

  NODE_ENV: process.env.NODE_ENV || "development",
} as const;

export function validateRuntimeEnv() {
  validateDatabaseUrl("DATABASE_URL", env.DATABASE_URL);
  if (env.DIRECT_URL) {
    validateDatabaseUrl("DIRECT_URL", env.DIRECT_URL);
  }

  assertNoSurroundingQuotes("JWT_SECRET", env.JWT_SECRET);
  assertMinLength("JWT_SECRET", env.JWT_SECRET, 32);
  assertBase64Key("API_KEY_ENCRYPTION_KEY", env.API_KEY_ENCRYPTION_KEY, 32);
  validateAppBaseUrl(env.APP_BASE_URL);
  validateGoogleRedirectUri(env.GOOGLE_REDIRECT_URI);
  validateSmtpPort(env.SMTP_PORT);

  if (env.CRON_SECRET) {
    assertNoSurroundingQuotes("CRON_SECRET", env.CRON_SECRET);
  }
}
