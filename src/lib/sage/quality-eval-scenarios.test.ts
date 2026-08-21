import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { buildSystemPrompt } from "./system-prompts";
import {
  QUALITY_EVAL_CONTEXT_HEADER,
  QUALITY_EVAL_NO_TOOLS_DIRECTIVE,
  buildQualityEvalPrompt,
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
 * That takes TWO things, and the first pass shipped only one.
 *
 *   1. Supply the facts on the scenario, the way retrieval supplies them in
 *      production (`context` → PROGRAM DOCUMENT REFERENCE block).
 *   2. Tell the model no tools are connected.
 *
 * Without (2), grounding the scenario changed nothing: the tool catalog still
 * advertises `find_certification(query)` for "what's available in a category",
 * so `info-certs` kept routing to a tool instead of answering. Measured on
 * Ollama 0.32.4 / gemma4:latest, the grounded-but-unpoliced prompt produced an
 * empty reply on 10 of 10 draws while the ungrounded control (`resume-help`)
 * produced prose on 10 of 10. The emitted tokens were a tool call
 * (`call:find_certification(query="…")`, visible via raw /api/generate) that
 * Ollama's gemma4 parser strips from `content` — with no tools on the request,
 * `finish_reason: "tool_calls"` and content "". Adding (2) took it to 0 of 10
 * empty. These tests keep both halves enforced.
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

/**
 * The harness generates with no tools. These lock in that it SAYS so — the
 * half the 2026-07-27 first pass left out, which is why grounding `info-certs`
 * did not stop it returning "".
 */
describe("sage quality eval — no-tools policy", () => {
  /** Mirrors the harness, which sets this before building any prompt. */
  const ORIGINAL_AGENT_ENABLED = process.env.SAGE_AGENT_ENABLED;
  before(() => {
    process.env.SAGE_AGENT_ENABLED = "true";
  });
  after(() => {
    if (ORIGINAL_AGENT_ENABLED === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = ORIGINAL_AGENT_ENABLED;
  });

  const promptFor = (scenario: QualityScenario): string =>
    buildSystemPrompt(
      scenario.stage as Parameters<typeof buildSystemPrompt>[0],
      { studentName: "Sam", programType: "spokes" },
      "full",
    );

  it("the prompt under test really does advertise the tool that swallowed info-certs", () => {
    // The reason the directive has to exist. If agent mode ever stops putting a
    // tool catalog in the student prompt, this fails and the rationale above
    // needs rewriting rather than quietly rotting.
    const prompt = promptFor(SCENARIOS.find((s) => s.id === "info-certs") ?? SCENARIOS[0]);
    assert.ok(
      prompt.includes("find_certification"),
      "the agent prompt no longer advertises find_certification — re-check whether the " +
        "quality harness still needs a no-tools directive before deleting it",
    );
  });

  it("every scenario is told no tools are connected", () => {
    for (const scenario of SCENARIOS) {
      const assembled = buildQualityEvalPrompt(promptFor(scenario), scenario.context);
      assert.ok(
        assembled.includes(QUALITY_EVAL_NO_TOOLS_DIRECTIVE),
        `scenario "${scenario.id}" reaches the model without the no-tools directive. The prompt ` +
          `advertises tools the harness cannot execute, so a tool-mapped question comes back as ` +
          `an empty reply and is skipped before scoring.`,
      );
    }
  });

  it("the directive lands before the grounding block, so the reference stays last", () => {
    // Production appends PROGRAM DOCUMENT REFERENCE at the very end and
    // RAG_GROUNDING_INSTRUCTION points at "below". Slipping the directive after
    // it would put harness scaffolding between that instruction and its target.
    for (const scenario of SCENARIOS.filter((s) => s.context?.trim())) {
      const assembled = buildQualityEvalPrompt(promptFor(scenario), scenario.context);
      assert.ok(
        assembled.indexOf(QUALITY_EVAL_NO_TOOLS_DIRECTIVE) <
          assembled.indexOf(QUALITY_EVAL_CONTEXT_HEADER),
        `scenario "${scenario.id}" puts the no-tools directive after its grounding block`,
      );
      assert.ok(
        assembled.trimEnd().endsWith(scenario.context!.trim()),
        `scenario "${scenario.id}" no longer ends with its grounding context`,
      );
    }
  });

  it("appends to the real prompt rather than editing it", () => {
    // The standing rule: fix the harness, never the production guardrail.
    for (const scenario of SCENARIOS) {
      const base = promptFor(scenario);
      assert.ok(
        buildQualityEvalPrompt(base, scenario.context).startsWith(base),
        `scenario "${scenario.id}" mutates the production prompt instead of appending to it`,
      );
    }
  });

  it("forbids narrating a lookup the harness never ran", () => {
    // Not decoration. A terser draft ("no tools are connected, answer in
    // words") cleared the empty replies but drew "I checked our catalog for
    // you" — invented tool use that would have scored as good coaching.
    for (const claim of ["looked something up", "searched", "checked a catalog"]) {
      assert.ok(
        QUALITY_EVAL_NO_TOOLS_DIRECTIVE.includes(claim),
        `the directive stopped forbidding "${claim}" — without it the model narrates a lookup ` +
          `it never performed and the judge scores the fabrication`,
      );
    }
  });

  it("a scenario with no context still gets the directive", () => {
    const base = buildSystemPrompt("general", { studentName: "Sam", programType: "spokes" }, "full");
    // No tools exist for ANY scenario, so the statement cannot be conditional
    // on grounding — resume-help maps onto review_portfolio just as cleanly.
    assert.ok(buildQualityEvalPrompt(base, undefined).includes(QUALITY_EVAL_NO_TOOLS_DIRECTIVE));
    assert.ok(buildQualityEvalPrompt(base, "   ").includes(QUALITY_EVAL_NO_TOOLS_DIRECTIVE));
    assert.equal(withScenarioContext(base, undefined), base);
  });
});
