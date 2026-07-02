// =============================================================================
// Sage Agent — Per-Student Per-Tool Rate Limits
//
// Sliding-window caps enforced in the executor BEFORE tool.execute runs, so a
// runaway agent loop (or an abusive prompt) can't hammer a single tool. Reuses
// the repo's existing keyed-counter store (RateLimitEntry via rateLimit /
// rateLimitDaily in @/lib/rate-limit) — NO new table, NO migration.
//
// Limits are per (student, tool) and scoped by the tool's risk tier:
//   - mutate_consequential : 5  / day    (HMAC-confirmed writes; low volume)
//   - mutate_reversible    : 20 / day    (trivially-undoable writes)
//   - read                 : 200 / hour  (lookups/search — higher volume)
//
// This composes WITH — and never replaces — the #97 token/cost quota
// (checkTokenQuota). Cost quota caps total model spend per student per day;
// this caps *tool invocations* per tool. Both must pass.
// =============================================================================

import { rateLimit, rateLimitDaily } from "@/lib/rate-limit";
import type { RiskTier } from "./types";

const HOUR_MS = 60 * 60 * 1000;

/** A tier's window kind + default cap (env-overridable). */
interface TierLimit {
  window: "day" | "hour";
  limit: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the limit for a tier. Read each call (not module-load) so tests and
 * per-deploy env overrides take effect without a cold start.
 */
function limitForTier(tier: RiskTier): TierLimit {
  switch (tier) {
    case "mutate_consequential":
      return { window: "day", limit: envInt("SAGE_TOOL_RATE_CONSEQUENTIAL", 5) };
    case "mutate_reversible":
      return { window: "day", limit: envInt("SAGE_TOOL_RATE_REVERSIBLE", 20) };
    case "read":
      return { window: "hour", limit: envInt("SAGE_TOOL_RATE_READ", 200) };
  }
}

export interface ToolRateLimitDecision {
  allowed: boolean;
  /** Remaining calls in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetTime: number;
  limit: number;
  window: "day" | "hour";
}

/**
 * Namespaced key so agent-tool counters never collide with other rate-limit
 * consumers sharing the RateLimitEntry table.
 */
function keyFor(studentId: string, toolName: string, window: "day" | "hour"): string {
  return `sage-tool:${window}:${studentId}:${toolName}`;
}

/**
 * Consume one unit against a student's per-tool budget for the given tier.
 * Returns the decision; the executor turns a blocked decision into a friendly,
 * audited error record (it does NOT throw).
 */
export async function checkToolRateLimit(
  studentId: string,
  toolName: string,
  tier: RiskTier,
): Promise<ToolRateLimitDecision> {
  const { window, limit } = limitForTier(tier);
  const key = keyFor(studentId, toolName, window);

  const result =
    window === "day"
      ? await rateLimitDaily(key, limit)
      : await rateLimit(key, limit, HOUR_MS);

  return {
    allowed: result.success,
    remaining: result.remaining,
    resetTime: result.resetTime,
    limit,
    window,
  };
}

/** Human-readable message for a blocked call, safe to surface in chat. */
export function rateLimitMessage(toolName: string, decision: ToolRateLimitDecision): string {
  const per = decision.window === "day" ? "today" : "this hour";
  return `You've reached the limit for that action ${per} (${decision.limit} ${toolName} calls). Please try again later.`;
}
