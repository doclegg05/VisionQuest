// =============================================================================
// Sage Agent — Enablement Flags
//
// Single source of truth for whether the agent tool loop runs and, when it
// does, which risk tiers of tools are permitted. Replaces the two duplicated
// isAgentEnabled() helpers that lived in the chat send + slash-commands routes.
//
// Modes:
//   "off"      — agent loop disabled entirely (chat falls back to plain stream;
//                slash-command palette is empty). Matches today's prod default.
//   "readonly" — agent may call only "read"-tier tools (no writes).
//   "full"     — agent may call every tier, with mutate_consequential tools
//                still gated by the HMAC confirm-card round-trip (write-tools).
//
// SAGE_AGENT_MODE is the new control. When it is unset we fall back to the
// legacy SAGE_AGENT_ENABLED boolean, preserving its EXACT prior semantics:
// enabled unless the value is literally "false" (case-insensitive, trimmed).
// =============================================================================

import type { AgentTool, RiskTier } from "./types";

export type AgentMode = "off" | "readonly" | "full";

const VALID_MODES: ReadonlySet<string> = new Set<AgentMode>(["off", "readonly", "full"]);

/**
 * Resolve the active agent mode from the environment.
 *
 * Precedence:
 *  1. SAGE_AGENT_MODE, when set to a valid value ("off"|"readonly"|"full").
 *  2. Legacy back-compat via SAGE_AGENT_ENABLED when SAGE_AGENT_MODE is
 *     unset (or set to an unrecognized value): "false" → "off", anything
 *     else (including unset) → "full". This is byte-for-byte the old
 *     `SAGE_AGENT_ENABLED?.trim().toLowerCase() !== "false"` rule mapped
 *     onto the new tri-state.
 */
export function agentMode(): AgentMode {
  const raw = process.env.SAGE_AGENT_MODE?.trim().toLowerCase();
  if (raw && VALID_MODES.has(raw)) {
    return raw as AgentMode;
  }
  // Legacy fallback — preserve SAGE_AGENT_ENABLED semantics exactly.
  return process.env.SAGE_AGENT_ENABLED?.trim().toLowerCase() === "false" ? "off" : "full";
}

/** True when the agent loop should run at all (readonly or full). */
export function isAgentLoopEnabled(mode: AgentMode = agentMode()): boolean {
  return mode !== "off";
}

/**
 * Whether a tool of the given tier may run under a mode.
 *  - off:       nothing.
 *  - readonly:  read tier only.
 *  - full:      every tier.
 * Exhaustive over RiskTier — a new tier is a compile error here.
 */
export function isTierAllowedInMode(tier: RiskTier, mode: AgentMode): boolean {
  if (mode === "off") return false;
  if (mode === "full") return true;
  // mode === "readonly"
  switch (tier) {
    case "read":
      return true;
    case "mutate_reversible":
    case "mutate_consequential":
      return false;
  }
}

/** Convenience wrapper used by the tool registry filter. */
export function isToolAllowedInMode(tool: AgentTool, mode: AgentMode): boolean {
  return isTierAllowedInMode(tool.riskTier, mode);
}
