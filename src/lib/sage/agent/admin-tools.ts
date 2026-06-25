/**
 * Sage admin management tools (Pillar 3 — manage the environment).
 *
 * These let an ADMIN, through chat, read live system status and change the
 * runtime AI-provider configuration — the highest-impact operational levers
 * (which model/provider serves every student). Hard rules:
 *  - Admin-only (requiredRoles: ["admin"]). Never reachable by students,
 *    teachers, or coordinators.
 *  - Confirmation-gated + ledgered: every change goes through the confirm card
 *    and is recorded, like every other write tool.
 *  - SECRETS NEVER FLOW THROUGH CHAT. API keys and Cloudflare credentials can
 *    be neither read nor set here — status only reports whether they are set,
 *    and config writes refuse those keys, pointing the admin to the secure
 *    Program Setup UI. Keeping secrets out of the model's context is a security
 *    necessity, not a scope cut.
 *
 * Feature flags like SAGE_AGENT_ENABLED are environment variables (set at
 * deploy), so they are intentionally not runtime-toggleable here.
 */

import {
  getPlainConfigValue,
  setPlainConfigValue,
  type SystemConfigKey,
} from "@/lib/system-config";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { confirmationGate, executeAndLedger } from "./write-tools";
import type { AgentTool, AgentToolResult } from "./types";

// Non-secret config the admin may read back as plain values.
const READABLE_CONFIG: { key: SystemConfigKey; label: string }[] = [
  { key: "ai_provider", label: "AI provider" },
  { key: "ai_provider_url", label: "Local AI URL" },
  { key: "ai_provider_model", label: "Local AI model" },
  { key: "ai_provider_auth_mode", label: "Local AI auth mode" },
  { key: "ai_provider_num_ctx", label: "Local AI context window" },
];

// Secrets we only report as set/unset — never their value.
const SECRET_CONFIG: { key: SystemConfigKey; label: string }[] = [
  { key: "gemini_api_key", label: "Gemini API key" },
  { key: "ai_provider_api_key", label: "Local AI API key" },
  { key: "ai_provider_cloudflare_access_client_id", label: "Cloudflare Access client id" },
  { key: "ai_provider_cloudflare_access_client_secret", label: "Cloudflare Access client secret" },
];

const NUM_CTX_MIN = 1024;
const NUM_CTX_MAX = 131072;

/**
 * Validate + normalize a settable config value. Returns the value to store or
 * an error string. Secret keys are rejected outright.
 */
export function validateConfigChange(
  key: string,
  rawValue: string,
): { value: string } | { error: string } {
  const value = rawValue.trim();
  switch (key) {
    case "ai_provider":
      return value === "cloud" || value === "local"
        ? { value }
        : { error: 'ai_provider must be "cloud" or "local".' };
    case "ai_provider_auth_mode":
      return ["none", "bearer", "cloudflare_service_token"].includes(value)
        ? { value }
        : { error: "auth mode must be none, bearer, or cloudflare_service_token." };
    case "ai_provider_url":
      return isSafeAiProviderUrl(value)
        ? { value }
        : { error: "URL must be localhost/127.0.0.1/::1 or a public http/https endpoint." };
    case "ai_provider_model":
      if (!value || value.length > 200) return { error: "Model name is empty or too long." };
      return { value };
    case "ai_provider_num_ctx": {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < NUM_CTX_MIN || n > NUM_CTX_MAX) {
        return { error: `Context window must be an integer between ${NUM_CTX_MIN} and ${NUM_CTX_MAX}.` };
      }
      return { value: String(n) };
    }
    default:
      return {
        error:
          "That setting can't be changed from chat. Secrets (API keys, Cloudflare credentials) must be set in Program Setup > AI Provider, never through Sage.",
      };
  }
}

const SETTABLE_KEYS = new Set([
  "ai_provider",
  "ai_provider_url",
  "ai_provider_model",
  "ai_provider_auth_mode",
  "ai_provider_num_ctx",
]);

// ─── get_system_status ──────────────────────────────────────────────────────

const getSystemStatus: AgentTool = {
  name: "get_system_status",
  description:
    "Report the live system configuration an admin can manage: the active AI provider and its settings, and which credentials are set (never the secret values). Read-only, admin only.",
  parameters: { type: "object", properties: {} },
  slashCommand: {
    command: "/system",
    label: "System status",
    description: "Show AI provider + config status",
  },
  requiredRoles: ["admin"],
  enabled: true,
  async execute(): Promise<AgentToolResult> {
    const readable = await Promise.all(
      READABLE_CONFIG.map(async (c) => ({
        label: c.label,
        value: (await getPlainConfigValue(c.key)) ?? "(default)",
      })),
    );
    const secrets = await Promise.all(
      SECRET_CONFIG.map(async (c) => ({
        label: c.label,
        set: Boolean(await getPlainConfigValue(c.key)),
      })),
    );

    return {
      status: "success",
      summary: "Loaded current system configuration.",
      data: { config: readable, secrets },
      action: { action: "navigate", target: "/admin", label: "Open Program Setup" },
      modelHint:
        `Current config — ${readable.map((r) => `${r.label}: ${r.value}`).join("; ")}. ` +
        `Credentials — ${secrets.map((s) => `${s.label}: ${s.set ? "set" : "not set"}`).join("; ")}. ` +
        "Report this plainly to the admin. NEVER reveal or guess a secret value; you only know whether each is set. " +
        "To change a non-secret setting, use set_system_config.",
    };
  },
};

// ─── set_system_config ──────────────────────────────────────────────────────

const setSystemConfig: AgentTool = {
  name: "set_system_config",
  description:
    "Change a non-secret AI-provider setting (ai_provider, ai_provider_url, ai_provider_model, ai_provider_auth_mode, ai_provider_num_ctx). Admin only; requires confirmation. Cannot set API keys or other secrets.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        enum: [...SETTABLE_KEYS] as string[],
        description: "Which setting to change.",
      },
      value: { type: "string", description: "The new value." },
    },
    required: ["key", "value"],
  },
  requiredRoles: ["admin"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const key = String(args.key ?? "").trim();
    const rawValue = String(args.value ?? "");

    if (!SETTABLE_KEYS.has(key)) {
      return {
        status: "error",
        summary:
          "That setting can't be changed from chat. Secrets must be set in Program Setup > AI Provider.",
      };
    }
    const validated = validateConfigChange(key, rawValue);
    if ("error" in validated) {
      return { status: "error", summary: validated.error };
    }

    const gate = await confirmationGate(
      "set_system_config",
      { key, value: validated.value },
      ctx,
      `Change system setting "${key}" to "${validated.value}"? This affects AI for all users.`,
      `Set ${key}`,
    );
    if (gate) return gate;

    return executeAndLedger("set_system_config", { key, value: validated.value }, ctx, async () => {
      await setPlainConfigValue(key as SystemConfigKey, validated.value, ctx.session.id);
      return {
        summary: `Updated "${key}" to "${validated.value}".`,
        data: { key, value: validated.value },
      };
    });
  },
};

export const ADMIN_TOOLS: AgentTool[] = [getSystemStatus, setSystemConfig];
