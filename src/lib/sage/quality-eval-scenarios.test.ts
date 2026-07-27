import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "./system-prompts";
import {
  QUALITY_EVAL_CONTEXT_HEADER,
  withScenarioContext,
} from "../../../scripts/lib/sage-quality-eval-prompt.mjs";

/**
 * Contract tests for the scenarios in config/sage-quality-eval.json, which are
 * driven by scripts/sage-quality-eval.mjs.
 *
 * The harness scores Sage's coaching TEXT, so it calls
 * provider.generateResponse WITHOUT tools — tool selection is
 * sage:agent:eval's job. But it builds the REAL student prompt, and that
 * prompt runs with the agent loop on, where the ~5k-token program knowledge
 * dump is replaced by a topic index plus "call `lookup_program_info(topic)`
 * first, don't recite knowledge you haven't loaded".
 *
 * So a scenario that asks Sage to recite program specifics is unanswerable by
 * construction: the prompt sends her to a tool the harness never supplies, and
 * she correctly emits nothing. That is what "?? info-certs: empty reply" was
 * (observed 2026-07-27 on gemma4:latest and gemma4:26b-a4b-it-qat) — an
 * un-runnable scenario, not a model or guardrail failure. An empty reply is
 * skipped before scoring, so the scenario silently contributed nothing to
 * either the judge's pass rate or the Flesch-Kincaid reading-level average.
 *
 * The fix is to supply the facts on the scenario, the way retrieval supplies
 * them in production. These tests keep that contract enforced.
 */

interface QualityScenario {
  id: string;
  stage: string;
  message: string;
  focus: string;
  context?: string;
}

const SCENARIOS: QualityScenario[] = JSON.parse(
  readFileSync("config/sage-quality-eval.json", "utf8"),
);

/**
 * Program proper nouns that live behind `lookup_program_info` under agent
 * mode. A scenario whose `focus` demands one of these is asking for recall the
 * tool-less harness cannot support unless the scenario supplies it.
 */
const TOOL_GATED_PROGRAM_TERMS = [
  "IC3",
  "MOS",
  "Microsoft Office Specialist",
  "WorkKeys",
  "QuickBooks",
  "GMetrix",
  "Certiport",
  "Essential Education",
];

describe("sage quality eval scenarios", () => {
  it("every scenario has the fields the harness reads", () => {
    assert.ok(SCENARIOS.length > 0, "config/sage-quality-eval.json is empty");
    for (const scenario of SCENARIOS) {
      for (const field of ["id", "stage", "message", "focus"] as const) {
        assert.equal(
          typeof scenario[field],
          "string",
          `scenario "${scenario.id}" is missing a string "${field}"`,
        );
        assert.ok(scenario[field].trim().length > 0, `scenario "${scenario.id}" has an empty "${field}"`);
      }
    }
  });

  it("a scenario demanding program specifics supplies them itself", () => {
    for (const scenario of SCENARIOS) {
      const demanded = TOOL_GATED_PROGRAM_TERMS.filter((term) => scenario.focus.includes(term));
      if (demanded.length === 0) continue;

      assert.ok(
        scenario.context?.trim(),
        `scenario "${scenario.id}" grades Sage on naming ${demanded.join(", ")}, but supplies no ` +
          `"context". Under agent mode those facts sit behind lookup_program_info, and the quality ` +
          `harness generates with no tools — so Sage defers to the tool and returns an empty reply. ` +
          `Add a "context" grounding block to the scenario (the harness injects it the way retrieval ` +
          `does in production), or rewrite the scenario so it does not grade recall.`,
      );

      for (const term of demanded) {
        assert.ok(
          scenario.context!.includes(term),
          `scenario "${scenario.id}" grades Sage on naming "${term}", but its "context" block does ` +
            `not contain it — Sage would have to invent it, which the guardrails correctly forbid.`,
        );
      }
    }
  });

  it("supplied context reaches the prompt as a grounding block, not a dropped field", () => {
    const grounded = SCENARIOS.filter((scenario) => scenario.context?.trim());
    assert.ok(
      grounded.length > 0,
      "no scenario supplies context — if info-certs lost its grounding block, the empty-reply bug is back",
    );

    for (const scenario of grounded) {
      const base = buildSystemPrompt(
        scenario.stage as Parameters<typeof buildSystemPrompt>[0],
        { studentName: "Sam", programType: "spokes" },
        "full",
      );
      const assembled = withScenarioContext(base, scenario.context);

      assert.ok(
        assembled.includes(QUALITY_EVAL_CONTEXT_HEADER),
        `scenario "${scenario.id}" supplies context but the harness did not wrap it in the ` +
          `PROGRAM DOCUMENT REFERENCE block production uses, so RAG_GROUNDING_INSTRUCTION would ` +
          `not tell Sage to answer from it`,
      );
      assert.ok(
        assembled.includes(scenario.context!.trim()),
        `scenario "${scenario.id}" supplies context that never reached the assembled prompt`,
      );
      assert.ok(
        assembled.startsWith(base),
        `scenario "${scenario.id}" context must be APPENDED to the real prompt, the way ` +
          `/api/chat/send appends getDocumentContext — not spliced into it`,
      );
    }
  });

  it("leaves a scenario without context untouched", () => {
    const base = buildSystemPrompt("general", { studentName: "Sam", programType: "spokes" }, "full");
    assert.equal(withScenarioContext(base, undefined), base);
    assert.equal(withScenarioContext(base, "   "), base);
  });

  it("the stages the scenarios use are real prompt stages", () => {
    for (const scenario of SCENARIOS) {
      const prompt = buildSystemPrompt(
        scenario.stage as Parameters<typeof buildSystemPrompt>[0],
        { studentName: "Sam", programType: "spokes" },
        "full",
      );
      assert.ok(
        prompt.trim().length > 0,
        `scenario "${scenario.id}" uses stage "${scenario.stage}", which builds an empty prompt`,
      );
    }
  });
});
