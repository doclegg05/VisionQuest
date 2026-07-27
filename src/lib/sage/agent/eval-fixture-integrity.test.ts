// =============================================================================
// Agent-eval fixture integrity.
//
// Found 2026-07-27 during the local-AI model evaluation: several scenarios
// expected a tool whose REQUIRED id parameter appeared nowhere in the prompt
// the model receives. `job-save` expected save_job (requires jobListingId)
// with no context at all; `submit-signed-dress` expected submit_form
// (requires orientationItemId) with only a file attachment. The expected call
// was impossible to construct, so every model was penalized for behaving
// rationally — and no prompt or tool-description work could ever fix it.
// Two separate sessions burned time chasing those as model failures.
//
// This test makes the defect class impossible to reintroduce: if a scenario
// expects a tool that needs an opaque id, the scenario must supply that id
// (context or attachment) or name a tool that can resolve it in
// acceptableTools.
// =============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getEnabledTools } from "./tools";

const FIXTURE = path.resolve(__dirname, "..", "..", "..", "..", "config", "sage-agent-eval.json");

interface Scenario {
  id: string;
  message: string;
  expectedTool: string | null;
  acceptableTools?: string[];
  context?: string;
  attachment?: { fileUploadId: string };
}

interface ToolShape {
  required: string[];
  props: Record<string, { enum?: unknown[] } | undefined>;
}

function loadTools(): Map<string, ToolShape> {
  const byName = new Map<string, ToolShape>();
  for (const role of ["student", "teacher", "admin", "coordinator"]) {
    for (const tool of getEnabledTools(role)) {
      if (byName.has(tool.name)) continue;
      byName.set(tool.name, {
        required: (tool.parameters?.required as string[]) ?? [],
        props: (tool.parameters?.properties ?? {}) as ToolShape["props"],
      });
    }
  }
  return byName;
}

/**
 * An id the model cannot invent. An enum-constrained id is derivable — its
 * allowed values ship in the tool schema (open_resource's resourceId).
 */
function isOpaqueId(param: string, schema: { enum?: unknown[] } | undefined): boolean {
  const looksLikeId = /(^|[a-z])(Id|Ids)$/.test(param) || param === "id";
  return looksLikeId && !schema?.enum?.length;
}

describe("agent eval fixture integrity", () => {
  const scenarios: Scenario[] = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const tools = loadTools();

  it("every expectedTool is a real, enabled tool", () => {
    for (const s of scenarios) {
      if (s.expectedTool === null) continue; // intentional "no tool should fire"
      assert.ok(tools.has(s.expectedTool), `${s.id}: expectedTool "${s.expectedTool}" is not an enabled tool`);
    }
  });

  it("every acceptableTools entry is a real, enabled tool", () => {
    for (const s of scenarios) {
      for (const name of s.acceptableTools ?? []) {
        assert.ok(tools.has(name), `${s.id}: acceptableTools names unknown tool "${name}"`);
      }
    }
  });

  it("no scenario expects a tool whose required id it never supplies", () => {
    const broken: string[] = [];

    for (const s of scenarios) {
      if (s.expectedTool === null) continue;
      const tool = tools.get(s.expectedTool);
      if (!tool) continue; // covered by the test above

      const opaque = tool.required.filter((p) => isOpaqueId(p, tool.props[p]));
      if (opaque.length === 0) continue;

      // Exactly what the harness puts in front of the model.
      const supplied = [s.message, s.context ?? "", s.attachment ? JSON.stringify(s.attachment) : ""].join("\n");

      const missing = opaque.filter((p) =>
        p === "fileUploadId" ? !s.attachment && !/fileUploadId/i.test(supplied) : !new RegExp(p, "i").test(supplied),
      );
      if (missing.length === 0) continue;

      // A scenario may instead name a tool that resolves the id first.
      if ((s.acceptableTools ?? []).length > 0) continue;

      broken.push(
        `${s.id}: expects ${s.expectedTool} which requires [${missing.join(", ")}], ` +
          `but the scenario supplies no such id and offers no acceptableTools fallback`,
      );
    }

    assert.deepEqual(
      broken,
      [],
      `Uncallable eval expectations — supply the id in \`context\` (see job-match-cna) ` +
        `or add a resolving tool to \`acceptableTools\`:\n  ${broken.join("\n  ")}`,
    );
  });
});
