import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getEnabledTools } from "./agent/tools";
import { CAREER_GROUNDING_TOOL_NAMES } from "../../../scripts/lib/sage-career-eval.mjs";
import {
  computeAgentEvalExitCode,
  isWatchScenario,
  summarizeAgentEvalAccuracy,
} from "../../../scripts/sage-agent-eval.mjs";

/**
 * Contract tests for config/sage-agent-eval.json, driven by
 * scripts/sage-agent-eval.mjs.
 *
 * The eval reports tool-selection accuracy over the real student registry. A
 * scenario naming a tool the registry no longer exposes cannot be satisfied by
 * any model, so it reports a permanent MISS that reads exactly like a
 * regression — the cheapest possible bug to catch here and an expensive one to
 * chase in a nightly.
 *
 * The coverage test at the bottom is the reason this file exists. The five
 * CareerOneStop grounding tools and tailor_application were registered in
 * src/lib/sage/agent/tools.ts and then appeared in NO fixture in any of the six
 * eval configs — the words "riasec", "pathway", "occupation" and "wage"
 * occurred zero times across all of them. Registration is not coverage.
 */

interface AgentEvalScenario {
  id: string;
  message: string;
  /** Optional in the type because a scenario may rely on acceptNoTool alone. */
  expectedTool?: string | null;
  acceptableTools?: string[];
  acceptNoTool?: boolean;
  forbiddenTools?: string[];
  context?: string;
  attachment?: { fileUploadId: string; filename: string; gist: string };
  note?: string;
  /** Opt out of the gating accuracy and the --min-accuracy denominator. */
  watch?: true;
}

/**
 * The scenario count the CI floor was calibrated against. It is asserted, not
 * derived: --min-accuracy=75 in .github/workflows/sage-evals.yml was set from a
 * measured rate over exactly this set, so growing the gating tier silently
 * moves the gate. New scenarios land as `"watch": true` and only join this
 * count when someone deliberately promotes them and re-checks the floor.
 */
const CALIBRATED_GATING_COUNT = 45;

const FIXTURE_PATH = "config/sage-agent-eval.json";
const SCRIPT_PATH = "scripts/sage-agent-eval.mjs";

const SCENARIOS: AgentEvalScenario[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
/** The eval declares the student registry; mode passed explicitly so env can't shift the result. */
const STUDENT_TOOLS = new Set(getEnabledTools("student", "full").map((tool) => tool.name));

describe("sage agent eval scenarios", () => {
  it("every scenario carries the fields the eval reads, with a unique id", () => {
    assert.ok(SCENARIOS.length > 0, `${FIXTURE_PATH} is empty`);
    const seen = new Set<string>();
    for (const scenario of SCENARIOS) {
      assert.ok(scenario.message?.trim(), `scenario "${scenario.id}" has no message`);
      assert.ok(!seen.has(scenario.id), `duplicate scenario id "${scenario.id}"`);
      seen.add(scenario.id);
      assert.ok(
        "expectedTool" in scenario || scenario.acceptNoTool,
        `scenario "${scenario.id}" declares neither an expectedTool nor acceptNoTool, so no outcome ` +
          `can satisfy it`,
      );
    }
  });

  it("every tool a scenario names is a real tool in the student registry", () => {
    for (const scenario of SCENARIOS) {
      const named = [
        scenario.expectedTool,
        ...(scenario.acceptableTools ?? []),
        ...(scenario.forbiddenTools ?? []),
      ].filter((name): name is string => Boolean(name));
      for (const name of named) {
        assert.ok(
          STUDENT_TOOLS.has(name),
          `scenario "${scenario.id}" names tool "${name}", which getEnabledTools("student") does not ` +
            `return. The scenario can never pass, and the eval reports it as a model miss.`,
        );
      }
    }
  });

  it("acceptableTools never repeats expectedTool", () => {
    for (const scenario of SCENARIOS) {
      assert.ok(
        !(scenario.acceptableTools ?? []).includes(scenario.expectedTool ?? ""),
        `scenario "${scenario.id}" lists its expectedTool in acceptableTools — a copy-paste that hides ` +
          `which selection the case actually wants`,
      );
    }
  });

  it("every career grounding tool has at least one selection scenario", () => {
    const expected = new Set(SCENARIOS.map((scenario) => scenario.expectedTool).filter(Boolean));
    for (const name of CAREER_GROUNDING_TOOL_NAMES) {
      assert.ok(
        expected.has(name),
        `no scenario expects "${name}". The five CareerOneStop tools are reachable by every student ` +
          `today; without a fixture, nothing measures whether Sage routes a career question to them ` +
          `at all — and a routing regression would land silently.`,
      );
    }
  });

  it("tailor_application has a selection scenario", () => {
    const scenario = SCENARIOS.find((s) => s.expectedTool === "tailor_application");
    assert.ok(
      scenario,
      "no scenario expects tailor_application — a mutate_consequential tool with no routing coverage",
    );
    assert.ok(
      scenario!.context?.includes("jobListingId"),
      `scenario "${scenario!.id}" expects tailor_application, whose only required parameter is a ` +
        `jobListingId, but supplies no saved-job context for the model to draw one from`,
    );
  });

  it("the watch field is either absent or exactly true", () => {
    for (const scenario of SCENARIOS) {
      if (!("watch" in scenario)) continue;
      assert.equal(
        scenario.watch,
        true,
        `scenario "${scenario.id}" sets watch to ${JSON.stringify(scenario.watch)}. The tier is ` +
          `opt-in: omit the field to gate. "watch": false reads like a deliberate demotion refusal ` +
          `and behaves like nothing at all.`,
      );
    }
  });

  it("the six career scenarios land in the watch tier, not the gate", () => {
    const career = SCENARIOS.filter((scenario) => scenario.id.startsWith("career-"));
    assert.equal(career.length, 6, "expected the six career coverage scenarios");
    for (const scenario of career) {
      assert.ok(
        isWatchScenario(scenario),
        `scenario "${scenario.id}" is in the gating tier, but its routing rate has never been ` +
          `measured. An unmeasured scenario in the denominator moves --min-accuracy without anyone ` +
          `deciding to — a clean tree can go red on arithmetic alone.`,
      );
    }
  });

  it("the gating tier still holds exactly the scenarios the floor was calibrated against", () => {
    const gating = SCENARIOS.filter((scenario) => !isWatchScenario(scenario));
    assert.equal(
      gating.length,
      CALIBRATED_GATING_COUNT,
      `the gating tier holds ${gating.length} scenarios, not the ${CALIBRATED_GATING_COUNT} that ` +
        `--min-accuracy=75 was calibrated against. If you are promoting a watch scenario on purpose, ` +
        `re-check the floor in .github/workflows/sage-evals.yml against a nightly that measured the ` +
        `new set, then update CALIBRATED_GATING_COUNT here in the same change.`,
    );
  });

  it("the eval never executes a tool, so career scenarios need no CareerOneStop credentials", () => {
    // If this eval ever started executing tools for real, these career
    // scenarios would fire live CareerOneStop requests from CI. Selection is
    // the whole job here; honesty after a not-configured result is the chat
    // harness's career family.
    const source = readFileSync(SCRIPT_PATH, "utf8");
    assert.ok(
      source.includes("noopToolHandler"),
      `${SCRIPT_PATH} no longer drives selection through a no-op handler — re-check what the career ` +
        `scenarios would now reach out to before letting this run in CI`,
    );
  });
});

/**
 * Tier arithmetic, exercised with synthetic outcomes — no live model, the same
 * pattern computeAgentEvalExitCode was extracted for. Both directions matter:
 * a watch tier that also swallowed gating failures would be a weakened gate,
 * not a safe entry path.
 */
describe("sage agent eval — watch tier", () => {
  const outcomes = (gatingCorrect: number, gatingTotal: number, watchCorrect: number, watchTotal: number) => [
    ...Array.from({ length: gatingTotal }, (_, i) => ({ id: `g${i}`, correct: i < gatingCorrect })),
    ...Array.from({ length: watchTotal }, (_, i) => ({ id: `w${i}`, watch: true, correct: i < watchCorrect })),
  ];

  it("a failing watch scenario does not trip the floor", () => {
    // The real shape of the collision: 36/45 gating (80%) with all six new
    // career scenarios missing. Pre-tier this was 36/51 = 70.6% and a red run.
    const summary = summarizeAgentEvalAccuracy(outcomes(36, 45, 0, 6));
    assert.equal(summary.gating.accuracyPct, 80);
    assert.equal(summary.watch.correct, 0);
    assert.equal(summary.watch.total, 6);
    assert.equal(
      computeAgentEvalExitCode({
        accuracyPct: summary.gating.accuracyPct,
        injectionFailures: 0,
        minAccuracy: 75,
      }),
      0,
    );
  });

  it("a gating set below the floor still exits non-zero, however clean the watch tier is", () => {
    const summary = summarizeAgentEvalAccuracy(outcomes(33, 45, 6, 6));
    assert.ok(summary.gating.accuracyPct < 75, "fixture should sit below the floor");
    assert.equal(summary.watch.accuracyPct, 100);
    assert.equal(
      computeAgentEvalExitCode({
        accuracyPct: summary.gating.accuracyPct,
        injectionFailures: 0,
        minAccuracy: 75,
      }),
      1,
    );
  });

  it("an injection failure gates from either tier", () => {
    const summary = summarizeAgentEvalAccuracy(outcomes(45, 45, 5, 6));
    assert.equal(summary.gating.accuracyPct, 100);
    assert.equal(
      computeAgentEvalExitCode({
        accuracyPct: summary.gating.accuracyPct,
        injectionFailures: 1,
        minAccuracy: 75,
      }),
      1,
      "a forbidden-tool call must fail the run even when every gating selection was right",
    );
  });

  it("a scenario set with no watch entries reports exactly the pre-tier number", () => {
    // The extend-only contract: for today's shape minus the watch field, the
    // gating tier IS every scenario and the accuracy is the old
    // correct / SCENARIOS.length.
    for (const [correct, total] of [
      [36, 45],
      [45, 45],
      [0, 45],
    ]) {
      const summary = summarizeAgentEvalAccuracy(outcomes(correct, total, 0, 0));
      assert.equal(summary.gating.total, total);
      assert.equal(summary.gating.accuracyPct, (correct / total) * 100);
      assert.equal(summary.watch.total, 0);
    }
  });

  it("an all-watch set cannot fail a floor it never measured", () => {
    const summary = summarizeAgentEvalAccuracy(outcomes(0, 0, 0, 6));
    assert.equal(summary.gating.total, 0);
    assert.equal(
      computeAgentEvalExitCode({
        accuracyPct: summary.gating.accuracyPct,
        injectionFailures: 0,
        minAccuracy: 75,
      }),
      0,
    );
  });

  it("the live run feeds the GATING accuracy to the exit-code gate", () => {
    // Wiring, not arithmetic: if main() ever passed the combined accuracy
    // again, every test above would still pass and the gate would be wrong.
    const source = readFileSync(SCRIPT_PATH, "utf8");
    assert.ok(
      source.includes("const summary = summarizeAgentEvalAccuracy(outcomes)"),
      `${SCRIPT_PATH} no longer summarizes outcomes by tier`,
    );
    assert.ok(
      source.includes("const accuracyPct = summary.gating.accuracyPct"),
      `${SCRIPT_PATH} no longer feeds the gating-tier accuracy into computeAgentEvalExitCode`,
    );
  });
});
