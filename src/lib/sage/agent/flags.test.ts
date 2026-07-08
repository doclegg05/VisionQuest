import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  agentMode,
  isAgentLoopEnabled,
  isTierAllowedInMode,
  isToolAllowedInMode,
  type AgentMode,
} from "./flags";
import { getEnabledTools } from "./tools";
import type { AgentTool, RiskTier } from "./types";

const ORIGINAL_MODE = process.env.SAGE_AGENT_MODE;
const ORIGINAL_ENABLED = process.env.SAGE_AGENT_ENABLED;

function setEnv(mode: string | undefined, enabled: string | undefined): void {
  if (mode === undefined) delete process.env.SAGE_AGENT_MODE;
  else process.env.SAGE_AGENT_MODE = mode;
  if (enabled === undefined) delete process.env.SAGE_AGENT_ENABLED;
  else process.env.SAGE_AGENT_ENABLED = enabled;
}

afterEach(() => {
  setEnv(ORIGINAL_MODE, ORIGINAL_ENABLED);
});

describe("agentMode — SAGE_AGENT_MODE precedence", () => {
  const explicit: Array<[string, AgentMode]> = [
    ["off", "off"],
    ["readonly", "readonly"],
    ["full", "full"],
    ["  Full  ", "full"], // trimmed + lowercased
    ["OFF", "off"],
  ];
  for (const [raw, expected] of explicit) {
    it(`maps SAGE_AGENT_MODE="${raw}" → ${expected}`, () => {
      setEnv(raw, "false"); // legacy present but MODE wins
      assert.equal(agentMode(), expected);
    });
  }

  it("ignores an unrecognized SAGE_AGENT_MODE and falls back to legacy", () => {
    setEnv("banana", "false");
    assert.equal(agentMode(), "off"); // legacy "false" → off
    setEnv("banana", "true");
    assert.equal(agentMode(), "full"); // legacy non-"false" → full
  });
});

describe("agentMode — legacy SAGE_AGENT_ENABLED back-compat (MODE unset)", () => {
  const cases: Array<[string | undefined, AgentMode]> = [
    ["false", "off"],
    ["FALSE", "off"],
    ["  false  ", "off"],
    ["true", "full"],
    ["", "full"], // empty is not literally "false"
    [undefined, "full"], // unset → the old default was "enabled"
    ["1", "full"],
  ];
  for (const [enabled, expected] of cases) {
    it(`SAGE_AGENT_ENABLED=${JSON.stringify(enabled)} → ${expected}`, () => {
      setEnv(undefined, enabled);
      assert.equal(agentMode(), expected);
    });
  }
});

describe("isAgentLoopEnabled", () => {
  it("is false only for off", () => {
    assert.equal(isAgentLoopEnabled("off"), false);
    assert.equal(isAgentLoopEnabled("readonly"), true);
    assert.equal(isAgentLoopEnabled("full"), true);
  });
});

describe("isTierAllowedInMode — full matrix", () => {
  const tiers: RiskTier[] = ["read", "mutate_reversible", "mutate_consequential"];
  const expected: Record<AgentMode, Record<RiskTier, boolean>> = {
    off: { read: false, mutate_reversible: false, mutate_consequential: false },
    readonly: { read: true, mutate_reversible: false, mutate_consequential: false },
    full: { read: true, mutate_reversible: true, mutate_consequential: true },
  };
  for (const mode of ["off", "readonly", "full"] as AgentMode[]) {
    for (const tier of tiers) {
      it(`${mode} × ${tier} → ${expected[mode][tier]}`, () => {
        assert.equal(isTierAllowedInMode(tier, mode), expected[mode][tier]);
      });
    }
  }
});

describe("isToolAllowedInMode", () => {
  const readTool = { riskTier: "read" } as AgentTool;
  const writeTool = { riskTier: "mutate_consequential" } as AgentTool;
  it("readonly admits read, rejects consequential", () => {
    assert.equal(isToolAllowedInMode(readTool, "readonly"), true);
    assert.equal(isToolAllowedInMode(writeTool, "readonly"), false);
  });
  it("full admits both", () => {
    assert.equal(isToolAllowedInMode(readTool, "full"), true);
    assert.equal(isToolAllowedInMode(writeTool, "full"), true);
  });
});

describe("getEnabledTools — mode filtering per role", () => {
  it("off yields no tools for any role", () => {
    assert.equal(getEnabledTools("student", "off").length, 0);
    assert.equal(getEnabledTools("teacher", "off").length, 0);
    assert.equal(getEnabledTools("admin", "off").length, 0);
  });

  it("readonly yields only read-tier tools", () => {
    for (const role of ["student", "teacher", "admin"]) {
      const tools = getEnabledTools(role, "readonly");
      assert.ok(tools.length > 0, `readonly should expose read tools for ${role}`);
      for (const tool of tools) {
        assert.equal(tool.riskTier, "read", `${tool.name} leaked into readonly`);
      }
    }
  });

  it("full is a strict superset of readonly and includes writes", () => {
    const readonly = getEnabledTools("student", "readonly");
    const full = getEnabledTools("student", "full");
    assert.ok(full.length > readonly.length, "full must expose more than readonly");
    const readonlyNames = new Set(readonly.map((t) => t.name));
    for (const name of readonlyNames) {
      assert.ok(full.some((t) => t.name === name), `full missing readonly tool ${name}`);
    }
    assert.ok(
      full.some((t) => t.riskTier === "mutate_consequential"),
      "full must include a consequential write tool for students",
    );
  });

  it("readonly still respects role scoping (admin-only tools stay admin-only)", () => {
    const studentReadonly = getEnabledTools("student", "readonly").map((t) => t.name);
    assert.ok(!studentReadonly.includes("get_system_status"), "admin read tool leaked to student");
    const adminReadonly = getEnabledTools("admin", "readonly").map((t) => t.name);
    assert.ok(adminReadonly.includes("get_system_status"), "admin read tool missing for admin");
  });
});

describe("tier exhaustiveness — every registered tool declares a valid tier", () => {
  it("all tools across all roles have a known riskTier", () => {
    const valid: ReadonlySet<RiskTier> = new Set(["read", "mutate_reversible", "mutate_consequential"]);
    const seen = new Map<string, RiskTier>();
    for (const role of ["student", "teacher", "admin"]) {
      for (const tool of getEnabledTools(role, "full")) seen.set(tool.name, tool.riskTier);
    }
    assert.ok(seen.size > 0, "expected a non-empty registry");
    for (const [name, tier] of seen) {
      assert.ok(valid.has(tier), `tool ${name} has invalid tier ${tier}`);
    }
  });
});
