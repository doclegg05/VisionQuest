import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "./system-prompts";
import { getEnabledTools } from "./agent/tools";
import { CAREER_GROUNDING_TOOLS } from "./agent/career-grounding-tools";
import {
  CHAT_EVAL_FAMILIES,
  CHAT_EVAL_FAMILY_NAMES,
} from "../../../scripts/lib/sage-chat-eval-families.mjs";
import {
  CAREER_CONTEXT_HEADER,
  CAREER_GROUNDING_TOOL_NAMES,
  buildCareerCasePrompt,
  compileMustNotMatch,
  evaluateCareerAssertions,
  runCareerToolUnconfigured,
  toolResultToHandlerResponse,
} from "../../../scripts/lib/sage-career-eval.mjs";

/**
 * Contract tests for config/sage-chat-eval.json, driven by
 * scripts/sage-chat-harness.mjs.
 *
 * Structural first: a case whose family the harness cannot run, or that names
 * a tool the registry no longer has, fails forever in a way that reads like a
 * model regression. Those are cheap to catch here and expensive to diagnose in
 * a nightly.
 *
 * Then the career family, which is new and carries the load this file was
 * written for. The five CareerOneStop tools (src/lib/sage/agent/career-grounding-tools.ts)
 * are registered and reachable in every deployment, and every one of them
 * returns notConfiguredResult() while COS_USER_ID / COS_API_TOKEN are absent —
 * the state prod is in today. That result's modelHint is the guardrail: say so
 * plainly, send the student to their instructor, "Do NOT invent wages, job
 * outlooks, or program names." No eval had ever exercised it. A gate never
 * observed failing is not yet a gate, so each career case carries a
 * `redBaseline` pair and the tests below run the SAME grader the harness runs
 * against both samples: the checks must fail the fabricated reply and pass the
 * honest one, proved without a live model.
 */

interface MustNotMatchEntry {
  label: string;
  pattern: string;
  flags?: string;
}

interface ChatEvalCase {
  id: string;
  family: string;
  role?: string;
  stage?: string;
  message: string;
  note?: string;
  comment?: string;
  context?: {
    seedConversation?: string;
    seedProbe?: string;
    groundingFacts?: string;
  };
  assert?: {
    expectedTool?: string;
    acceptableTools?: string[];
    acceptNoTool?: boolean;
    forbiddenTools?: string[];
    expectToolAny?: string[];
    mustContainAny?: string[];
    mustContainAll?: string[];
    mustNotContain?: string[];
    neverContain?: string[];
    mustNotMatch?: MustNotMatchEntry[];
    expectRefusal?: boolean;
    expectConfirmation?: boolean;
    expectCitationId?: string;
    memoryRecallAny?: string[];
    maxGrade?: number;
  };
  redBaseline?: { badReply: string; goodReply: string };
}

const FIXTURE_PATH = "config/sage-chat-eval.json";
const HARNESS_PATH = "scripts/sage-chat-harness.mjs";
const WORKFLOW_PATH = ".github/workflows/sage-evals.yml";

const CASES: ChatEvalCase[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const HARNESS_SOURCE = readFileSync(HARNESS_PATH, "utf8");
const CAREER_CASES = CASES.filter((testCase) => testCase.family === "career");

/** Same mapping the harness uses: student unless the case says teacher/admin. */
const registryRoleFor = (role?: string): string =>
  role === "teacher" || role === "admin" ? role : "student";

/** Mode passed explicitly so the result never depends on the runner's env. */
const toolNamesFor = (role?: string): Set<string> =>
  new Set(getEnabledTools(registryRoleFor(role), "full").map((tool) => tool.name));

describe("sage chat eval fixtures", () => {
  it("every case carries the fields the harness reads, with a unique id", () => {
    assert.ok(CASES.length > 0, `${FIXTURE_PATH} is empty`);
    const seen = new Set<string>();
    for (const testCase of CASES) {
      for (const field of ["id", "family", "message"] as const) {
        assert.equal(typeof testCase[field], "string", `case ${testCase.id} is missing "${field}"`);
        assert.ok(testCase[field].trim().length > 0, `case ${testCase.id} has an empty "${field}"`);
      }
      assert.ok(!seen.has(testCase.id), `duplicate case id "${testCase.id}" — the later one shadows the report row`);
      seen.add(testCase.id);
    }
  });

  it("every family in the fixture is one the harness can run", () => {
    for (const testCase of CASES) {
      assert.ok(
        CHAT_EVAL_FAMILY_NAMES.has(testCase.family),
        `case "${testCase.id}" uses family "${testCase.family}", which is not in CHAT_EVAL_FAMILIES ` +
          `(scripts/lib/sage-chat-eval-families.mjs). The harness would drop it into the unknown-family ` +
          `branch and report every case in that family as failed — missing wiring that reads as a red run.`,
      );
    }
  });

  it("the harness actually dispatches every family it claims to know", () => {
    for (const family of CHAT_EVAL_FAMILIES) {
      assert.ok(
        HARNESS_SOURCE.includes(`testCase.family === "${family.name}"`),
        `${HARNESS_PATH} has no dispatch branch for family "${family.name}" even though it is listed ` +
          `in CHAT_EVAL_FAMILIES. The list is a promise the runner has to keep.`,
      );
    }
  });

  it("the career branch feeds the case's supplied facts into the prompt", () => {
    // The grounded half of the family is worthless if context.groundingFacts
    // never reaches buildSystemPrompt's output — the reply would be graded on
    // facts the model was never given.
    assert.ok(
      HARNESS_SOURCE.includes("buildCareerCasePrompt(base, testCase.context?.groundingFacts)"),
      `${HARNESS_PATH} no longer passes context.groundingFacts through buildCareerCasePrompt`,
    );
  });

  it("every tool a case names is a real tool for that case's role", () => {
    for (const testCase of CASES) {
      const available = toolNamesFor(testCase.role);
      const named = [
        testCase.assert?.expectedTool,
        ...(testCase.assert?.acceptableTools ?? []),
        ...(testCase.assert?.forbiddenTools ?? []),
        ...(testCase.assert?.expectToolAny ?? []),
      ].filter((name): name is string => Boolean(name));
      for (const name of named) {
        assert.ok(
          available.has(name),
          `case "${testCase.id}" names tool "${name}", which the registry does not expose to role ` +
            `"${registryRoleFor(testCase.role)}". A renamed or dropped tool leaves the case permanently ` +
            `unpassable, and the nightly reports it as a model regression.`,
        );
      }
    }
  });

  it("the CI --families list only names families the harness runs", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");
    const invocation = workflow
      .split("\n")
      .find((line) => line.includes("sage-chat-harness.mjs") && line.includes("--families="));
    assert.ok(invocation, `${WORKFLOW_PATH} no longer invokes the chat harness with --families`);
    const gated = /--families=([a-z_,]+)/.exec(invocation!)![1].split(",");
    for (const family of gated) {
      assert.ok(
        CHAT_EVAL_FAMILY_NAMES.has(family),
        `${WORKFLOW_PATH} gates on family "${family}", which the harness cannot run`,
      );
    }

    // Not an anti-promotion lock: this asserts the soak state is REAL, so
    // "career is soaking" can't quietly become "career was never wired". The
    // promotion step is a one-word edit to the workflow's --families list once
    // the family has run green in nightlies; this test keeps passing after it.
    const soaking = [...CHAT_EVAL_FAMILY_NAMES].filter((family) => !gated.includes(family));
    assert.ok(
      CAREER_CASES.length > 0,
      "the career family has no cases — the fixtures were removed but the family wiring stayed",
    );
    assert.ok(
      soaking.includes("career") || gated.includes("career"),
      "family 'career' is neither gated nor soaking, which is not a state that exists",
    );
  });
});

describe("sage chat eval — career family fixtures", () => {
  /**
   * Nouns whose answer is a fact Sage does not hold: pay, a named training
   * provider, a labor-market outlook. A case built on one of these either
   * supplies the fact (the #143 pattern) or asserts that Sage declines to
   * invent it. Anything else grades nothing in particular.
   */
  const FACT_DEMANDING_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
    { label: "pay", regex: /\b(how much|make|pay|wage|salary|earn)\b/i },
    { label: "training provider", regex: /\b(school|training|program|class|college|certificate)\b/i },
    { label: "labor-market outlook", regex: /\b(outlook|demand|hiring|growing|still be around|future)\b/i },
  ];

  const REFERRAL_TERMS = ["instructor", "teacher", "caseworker"];

  it("every career case carries assertions that can fail, plus a red baseline", () => {
    for (const testCase of CAREER_CASES) {
      const a = testCase.assert ?? {};
      const graded =
        (a.mustNotMatch?.length ?? 0) +
        (a.mustContainAll?.length ?? 0) +
        (a.mustContainAny?.length ?? 0) +
        (a.mustNotContain?.length ?? 0);
      assert.ok(
        graded > 0,
        `career case "${testCase.id}" asserts nothing about the reply — it would pass on any text`,
      );
      assert.ok(
        testCase.redBaseline?.badReply?.trim() && testCase.redBaseline?.goodReply?.trim(),
        `career case "${testCase.id}" has no redBaseline pair, so nobody can tell whether its ` +
          `checks would catch the fabrication they target`,
      );
    }
  });

  it("a career case that asks for a fact either supplies it or asserts refusal", () => {
    for (const testCase of CAREER_CASES) {
      const demanded = FACT_DEMANDING_PATTERNS.filter((p) => p.regex.test(testCase.message));
      if (demanded.length === 0) continue;

      const grounded = Boolean(testCase.context?.groundingFacts?.trim());
      if (grounded) continue;

      const a = testCase.assert ?? {};
      assert.ok(
        (a.mustNotMatch?.length ?? 0) > 0,
        `career case "${testCase.id}" asks Sage for ${demanded.map((d) => d.label).join(", ")} ` +
          `without supplying the facts, so the only honest reply is a refusal — but it has no ` +
          `mustNotMatch guard, so an invented number would score as a pass. Either add a ` +
          `"context.groundingFacts" block (the way retrieval supplies facts in production) or ` +
          `assert the refusal.`,
      );
      assert.ok(
        (a.mustContainAny ?? []).some((term) =>
          REFERRAL_TERMS.some((referral) => term.toLowerCase().includes(referral)),
        ),
        `career case "${testCase.id}" checks that Sage invents nothing but never checks she hands ` +
          `the student somewhere real. notConfiguredResult()'s modelHint says to suggest asking the ` +
          `instructor; silence passes the no-numbers test and still leaves the student stuck.`,
      );
    }
  });

  it("a grounded career case only grades facts it supplied", () => {
    const grounded = CAREER_CASES.filter((testCase) => testCase.context?.groundingFacts?.trim());
    assert.ok(
      grounded.length > 0,
      "no career case supplies grounding facts — the family only tests refusal, never whether Sage " +
        "uses real data when it exists",
    );

    for (const testCase of grounded) {
      const facts = testCase.context!.groundingFacts!;
      for (const term of testCase.assert?.mustContainAll ?? []) {
        assert.ok(
          facts.includes(term),
          `career case "${testCase.id}" requires "${term}" in the reply but never supplies it — ` +
            `Sage would have to invent it, which is the behavior this family exists to forbid.`,
        );
      }
      const any = testCase.assert?.mustContainAny ?? [];
      if (any.length > 0) {
        assert.ok(
          any.some((term) => facts.includes(term)),
          `career case "${testCase.id}" accepts [${any.join(", ")}] but supplies none of them, so ` +
            `every acceptable answer is one Sage had to make up`,
        );
      }
    }
  });

  it("supplied facts reach the prompt as a reference block appended to the real prompt", () => {
    for (const testCase of CAREER_CASES.filter((c) => c.context?.groundingFacts?.trim())) {
      const base = buildSystemPrompt(
        (testCase.stage ?? "general") as Parameters<typeof buildSystemPrompt>[0],
        { studentName: "Sam", programType: "spokes" },
        "full",
      );
      const assembled: string = buildCareerCasePrompt(base, testCase.context!.groundingFacts);

      assert.ok(
        assembled.includes(CAREER_CONTEXT_HEADER),
        `career case "${testCase.id}" supplies facts that are not wrapped in the PROGRAM DOCUMENT ` +
          `REFERENCE block, so RAG_GROUNDING_INSTRUCTION never points Sage at them`,
      );
      assert.ok(
        assembled.startsWith(base),
        `career case "${testCase.id}" splices into the production prompt instead of appending to it — ` +
          `the harness fixes itself, never the guardrail`,
      );
      assert.ok(
        assembled.trimEnd().endsWith(testCase.context!.groundingFacts!.trim()),
        `career case "${testCase.id}" no longer ends with its reference block, the position production uses`,
      );
    }
  });

  it("every mustNotMatch entry compiles and names what it catches", () => {
    for (const testCase of CAREER_CASES) {
      for (const entry of testCase.assert?.mustNotMatch ?? []) {
        const compiled = compileMustNotMatch(entry);
        assert.ok(
          compiled.label.trim().length > 0,
          `career case "${testCase.id}" has an unlabelled mustNotMatch — a failing run would print a ` +
            `regex at whoever triages it`,
        );
        assert.ok(compiled.regex instanceof RegExp);
      }
    }
  });

  /**
   * Tool calls are held neutral in both directions (the case's first expected
   * tool, when it asks for one) so these two tests isolate the TEXT checks —
   * the half that decides whether a fabricated reply is caught.
   */
  const neutralCalls = (testCase: ChatEvalCase): string[] =>
    testCase.assert?.expectToolAny ? [testCase.assert.expectToolAny[0]] : [];

  it("each career case's checks reject its red-baseline fabrication", () => {
    for (const testCase of CAREER_CASES) {
      const { failures } = evaluateCareerAssertions({
        text: testCase.redBaseline!.badReply,
        calls: neutralCalls(testCase),
        assert: testCase.assert ?? {},
      });
      assert.ok(
        failures.length > 0,
        `career case "${testCase.id}" PASSES its own badReply:\n  "${testCase.redBaseline!.badReply}"\n` +
          `The checks cannot catch the failure they were written for.`,
      );
    }
  });

  it("every single mustNotMatch entry fires on its case's fabrication", () => {
    // The aggregate test above passes as long as ONE check fires, which hides a
    // dead one. The first draft of "invented growth statistic" ended in \b after
    // "%" — a boundary that can never match between "%" and a space — so it sat
    // in the fixture catching nothing while the case still went red on its
    // siblings. Every regex earns its place against the reply it was written for.
    for (const testCase of CAREER_CASES) {
      for (const entry of testCase.assert?.mustNotMatch ?? []) {
        const { failures } = evaluateCareerAssertions({
          text: testCase.redBaseline!.badReply,
          calls: neutralCalls(testCase),
          assert: { mustNotMatch: [entry] },
        });
        assert.ok(
          failures.length > 0,
          `career case "${testCase.id}": mustNotMatch "${entry.label}" (/${entry.pattern}/) does not ` +
            `match its own badReply. Either the pattern is broken or the badReply does not contain the ` +
            `fabrication it targets — either way the check has never been observed failing.`,
        );
      }
    }
  });

  it("each career case's checks accept its red-baseline honest reply", () => {
    for (const testCase of CAREER_CASES) {
      const { failures } = evaluateCareerAssertions({
        text: testCase.redBaseline!.goodReply,
        calls: neutralCalls(testCase),
        assert: testCase.assert ?? {},
      });
      assert.deepEqual(
        failures,
        [],
        `career case "${testCase.id}" FAILS its own goodReply — the checks fire on the reply we want, ` +
          `which is how a family becomes noise nobody promotes`,
      );
    }
  });
});

describe("sage chat eval — the mechanism the career family grades", () => {
  it("every career grounding tool reports not-configured, with the anti-fabrication hint", async () => {
    assert.equal(
      CAREER_GROUNDING_TOOLS.length,
      CAREER_GROUNDING_TOOL_NAMES.length,
      "the career grounding tool set changed — the harness's stub list needs the same edit",
    );
    for (const tool of CAREER_GROUNDING_TOOLS) {
      assert.ok(
        CAREER_GROUNDING_TOOL_NAMES.includes(tool.name),
        `tool "${tool.name}" is not in CAREER_GROUNDING_TOOL_NAMES, so the harness would hand the ` +
          `model a canned SUCCESS stub for it — a state production cannot produce`,
      );

      // No network: careerOneStopCredentials() is read per call and returns
      // null, so every one of these short-circuits before fetch.
      const result = await runCareerToolUnconfigured(tool, { occupation: "medical assistant" });
      assert.equal(result.status, "error", `${tool.name} did not report the unconfigured state as an error`);
      assert.ok(
        result.modelHint?.includes("Do NOT invent wages, job outlooks, or program names"),
        `${tool.name}'s not-configured modelHint no longer forbids inventing wages/outlooks/program ` +
          `names. That sentence IS what the career eval family grades — if it goes, the family is ` +
          `measuring nothing and the student-facing guardrail went with it.`,
      );
      assert.ok(
        /instructor/i.test(result.modelHint ?? ""),
        `${tool.name}'s not-configured modelHint no longer sends the student to their instructor`,
      );
    }
  });

  it("hands the model the modelHint the way the production agent loop does", () => {
    const withHint = toolResultToHandlerResponse({
      status: "error",
      summary: "Live career data isn't connected on this site yet.",
      modelHint: "Do NOT invent wages, job outlooks, or program names.",
    });
    assert.deepEqual(withHint.response, {
      summary: "Live career data isn't connected on this site yet.",
      modelHint: "Do NOT invent wages, job outlooks, or program names.",
      data: null,
    });
    assert.equal(withHint.status, "error");

    const withoutHint = toolResultToHandlerResponse({ status: "success", summary: "ok", data: { a: 1 } });
    assert.deepEqual(withoutHint.response, { a: 1 });

    // The mirror is only worth anything while production still hoists the hint
    // into the payload the model reads.
    const loopSource = readFileSync("src/lib/sage/agent/loop.ts", "utf8");
    assert.ok(
      loopSource.includes("modelHint: record.result.modelHint"),
      "src/lib/sage/agent/loop.ts no longer passes modelHint into the tool response payload — " +
        "toolResultToHandlerResponse in scripts/lib/sage-career-eval.mjs mirrors that mapping and " +
        "needs the same change, or the career family is grading a hint production never sends.",
    );
  });

  it("an empty reply fails instead of passing quietly", () => {
    // Three separate bugs have produced "" from a tool-call turn (#147 reasoning
    // budget, #149 undeclared-tool drop, a stale worktree client). The guardrail
    // family treats a tool-only turn as n/a; here the reply after the tool
    // result IS the subject, so silence is a failure.
    const { failures } = evaluateCareerAssertions({
      text: "",
      calls: ["career_wages"],
      assert: { mustContainAny: ["instructor"] },
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /empty reply after calling career_wages/);
  });
});
