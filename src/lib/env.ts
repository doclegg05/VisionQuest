/**
 * Environment variable validation — imported at app startup.
 * Throws immediately if a required variable is missing so deploys fail fast.
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
