import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  containsAny,
  looksTruncated,
  parseArgs,
  repetitionRatio,
  resolveFieldPath,
  runChatCase,
  runDraftCase,
  runStructuredCase,
  wordCount,
} from "../../../scripts/sage-model-bakeoff.mjs";
import { AI_ROLES } from "./roles";
import { EXTRACTION_PROMPT } from "../sage/memory/extract";
import { DETECTION_PROMPT } from "../sage/classroom-confirmation";
import { EXTRACT_PROMPT } from "../resume-extract";

const PRODUCTION_PROMPTS: Record<string, string> = {
  memory: EXTRACTION_PROMPT,
  classroom: DETECTION_PROMPT,
  resume: EXTRACT_PROMPT,
};

/**
 * Contract tests for config/sage-model-bakeoff.json and the deterministic
 * scoring helpers in scripts/sage-model-bakeoff.mjs.
 *
 * A bake-off is only worth running if its scoring is trustworthy: a fixture
 * whose gold facts cannot appear in any model's output reports a permanent
 * failure that reads exactly like a bad model, and a broken length or
 * repetition check silently promotes the wrong winner. Both are expensive to
 * discover on a machine that takes minutes per arm, and cheap to catch here.
 */

const fixture = JSON.parse(readFileSync("config/sage-model-bakeoff.json", "utf8"));

/**
 * Pull the first balanced {...} block out of a prompt and parse it.
 *
 * Prompts that show the model a literal JSON shape give us a machine-checkable
 * contract. Prompts that annotate theirs ("true | false") do not parse; return
 * null so the caller can fall back rather than fail a healthy fixture.
 */
function jsonSkeletonOf(prompt: string): unknown | null {
  const start = prompt.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < prompt.length; i++) {
    if (prompt[i] === "{") depth++;
    else if (prompt[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(prompt.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

describe("sage-model-bakeoff fixtures", () => {
  it("covers every AI role the code defines", () => {
    for (const role of AI_ROLES) {
      assert.ok(fixture.roles[role], `no bake-off fixtures for role "${role}"`);
      assert.ok(
        Array.isArray(fixture.roles[role].cases) && fixture.roles[role].cases.length > 0,
        `role "${role}" has no cases`,
      );
    }
  });

  it("defines no fixtures for roles that do not exist", () => {
    for (const role of Object.keys(fixture.roles)) {
      assert.ok(
        (AI_ROLES as readonly string[]).includes(role),
        `fixture role "${role}" is not a declared AiRole — it would never run`,
      );
    }
  });

  it("gives every case a unique id", () => {
    const ids = Object.values(fixture.roles).flatMap((role: unknown) =>
      (role as { cases: Array<{ id: string }> }).cases.map((c) => c.id),
    );
    assert.equal(new Set(ids).size, ids.length, "duplicate case id across the fixture set");
  });

  it("points every document case at a document fixture that exists", () => {
    for (const testCase of fixture.roles.document.cases) {
      assert.ok(
        fixture.documentFixtures?.[testCase.documentFixture],
        `case ${testCase.id} references missing documentFixture "${testCase.documentFixture}"`,
      );
    }
  });

  it("keeps every gold fact actually present in the source it is extracted from", () => {
    // A mustContainAny the input cannot support is an unfalsifiable case: no
    // model can pass it, and the report would blame the model.
    for (const testCase of fixture.roles.document.cases) {
      const document = fixture.documentFixtures[testCase.documentFixture];
      assert.ok(
        containsAny(document, testCase.mustContainAny),
        `case ${testCase.id} expects a fact that is not in its own document fixture`,
      );
    }
    for (const testCase of fixture.roles.extract.cases) {
      if (!testCase.mustContainAny) continue;
      const transcript = testCase.messages.map((m: { content: string }) => m.content).join("\n");
      assert.ok(
        containsAny(transcript, testCase.mustContainAny),
        `case ${testCase.id} expects a fact that is not in its own transcript`,
      );
    }
    for (const testCase of fixture.roles.draft.cases) {
      if (!testCase.mustContainAny) continue;
      const source = testCase.messages.map((m: { content: string }) => m.content).join("\n");
      assert.ok(
        containsAny(source, testCase.mustContainAny),
        `case ${testCase.id} expects a fact that is not in its own prompt`,
      );
    }
  });

  it("asserts only fields the production prompt actually promises, at the right depth", () => {
    // The contract these cases score against lives in the prompt, and it
    // NESTS: the resume parser returns {resume: {contact, experience}, ...}.
    // A case asserting a bare "contact" fails for every model and reads as a
    // model verdict rather than a fixture bug — which is exactly the mistake
    // this file was written after making. A substring check does not catch it
    // ("contact" is in the prompt, just one level down), so resolve each path
    // against the JSON skeleton the prompt actually shows the model.
    for (const role of ["extract", "document"] as const) {
      for (const testCase of fixture.roles[role].cases) {
        const prompt = PRODUCTION_PROMPTS[testCase.prompt];
        assert.ok(prompt, `case ${testCase.id} names unknown prompt "${testCase.prompt}"`);
        const paths: string[] = [
          ...(testCase.expectFields ?? []),
          ...Object.keys(testCase.expectFieldValues ?? {}),
        ];
        if (paths.length === 0) continue;

        const skeleton = jsonSkeletonOf(prompt);
        for (const path of paths) {
          if (skeleton !== null) {
            assert.notEqual(
              resolveFieldPath(skeleton, path),
              undefined,
              `case ${testCase.id} expects "${path}", which does not exist at that depth in the ${testCase.prompt} prompt's JSON shape`,
            );
          } else {
            // Prompts that annotate their shape ("true | false", "0.0 to 1.0")
            // are not parseable; fall back to presence of each segment.
            for (const segment of path.split(".")) {
              assert.ok(
                prompt.includes(`"${segment}"`),
                `case ${testCase.id} expects field "${segment}", which the ${testCase.prompt} prompt never promises`,
              );
            }
          }
        }
      }
    }
  });

  it("names a wrapper key the production prompt can actually emit", () => {
    for (const testCase of fixture.roles.extract.cases) {
      if (!testCase.expectJsonArrayOf) continue;
      const prompt = PRODUCTION_PROMPTS[testCase.prompt];
      assert.ok(
        prompt.includes(testCase.expectJsonArrayOf),
        `case ${testCase.id} unwraps "${testCase.expectJsonArrayOf}", which the ${testCase.prompt} prompt never mentions`,
      );
    }
  });

  it("uses coherent word-count bands on draft cases", () => {
    for (const testCase of fixture.roles.draft.cases) {
      if (typeof testCase.minWords !== "number" || typeof testCase.maxWords !== "number") continue;
      assert.ok(
        testCase.minWords < testCase.maxWords,
        `case ${testCase.id} has minWords >= maxWords`,
      );
    }
  });

  it("names a real tool on every chat case that expects one", async () => {
    const { getEnabledTools } = await import("./../sage/agent/tools");
    const available = new Set(getEnabledTools("student").map((tool) => tool.name));
    for (const testCase of fixture.roles.chat.cases) {
      if (!testCase.expectTool) continue;
      const acceptable: string[] = testCase.acceptableTools ?? [testCase.expectTool];
      // A case naming a tool the registry no longer exposes cannot be satisfied
      // by any model — it reports a permanent MISS that reads like a regression.
      assert.ok(
        acceptable.some((tool) => available.has(tool)),
        `case ${testCase.id} names no tool the student registry exposes (${acceptable.join(", ")})`,
      );
    }
  });
});

describe("sage-model-bakeoff scoring helpers", () => {
  it("detects a JSON reply that stopped mid-structure", () => {
    assert.equal(looksTruncated('{"a": 1, "b": [2, 3'), true);
    assert.equal(looksTruncated('{"a": 1, "b": [2, 3]}'), false);
    assert.equal(looksTruncated("plain prose with no braces"), false);
    assert.equal(looksTruncated(""), false);
  });

  it("matches gold facts case-insensitively", () => {
    assert.equal(containsAny("Worked at BELLWOOD Foods", ["bellwood"]), true);
    assert.equal(containsAny("Worked at Bellwood Foods", ["ridgeline"]), false);
    assert.equal(containsAny("", ["anything"]), false);
  });

  it("counts words without being fooled by whitespace", () => {
    assert.equal(wordCount("  one   two\nthree \t four "), 4);
    assert.equal(wordCount(""), 0);
  });

  it("flags degenerate repetition but not ordinary prose", () => {
    const looped = Array(20).fill("you should apply for the job today").join(" ");
    assert.ok(repetitionRatio(looped) > 0.25, "a looping model must be flagged");

    const varied =
      "Tanya has two years of cashier experience at a grocery store. She earned her " +
      "ServSafe certificate this year and is comfortable with food safety rules. " +
      "She is available in the mornings and rides the bus to work reliably.";
    assert.ok(repetitionRatio(varied) < 0.25, `ordinary prose must not be flagged`);
  });

  it("does not flag short text where the window does not apply", () => {
    assert.equal(repetitionRatio("too short to judge"), 0);
  });

  it("walks nested contracts through dotted field paths", () => {
    const parsed = { resume: { contact: { email: "a@b.c" } }, improvements: [] };
    assert.deepEqual(resolveFieldPath(parsed, "resume.contact"), { email: "a@b.c" });
    assert.equal(resolveFieldPath(parsed, "resume.contact.email"), "a@b.c");
    assert.equal(resolveFieldPath(parsed, "improvements") !== undefined, true);
    assert.equal(resolveFieldPath(parsed, "contact"), undefined);
    assert.equal(resolveFieldPath(parsed, "resume.missing.deep"), undefined);
    assert.equal(resolveFieldPath(null, "anything"), undefined);
  });

  it("resolves a false field value rather than treating it as missing", () => {
    // The classroom-negative case asserts confirmed === false; a presence check
    // that used truthiness would silently pass a model that omitted the field.
    assert.equal(resolveFieldPath({ confirmed: false }, "confirmed"), false);
    assert.notEqual(resolveFieldPath({ confirmed: false }, "confirmed"), undefined);
  });
});

describe("sage-model-bakeoff arguments", () => {
  it("requires at least one model", () => {
    assert.throws(() => parseArgs([]), /--models/);
  });

  it("rejects a duplicated model, which would compare an arm against itself", () => {
    assert.throws(() => parseArgs(["--models=a,a"]), /duplicate/);
  });

  it("rejects an unknown role rather than silently running nothing", () => {
    assert.throws(() => parseArgs(["--models=a", "--roles=embedding"]), /Unknown role/);
  });

  it("defaults to every role, eviction on, three repeats", () => {
    const options = parseArgs(["--models=a"]);
    assert.deepEqual(options.roles, [...AI_ROLES]);
    assert.equal(options.evict, true);
    assert.equal(options.repeats, 3);
  });

  it("honors --no-evict, which is the one flag that can invalidate a comparison", () => {
    assert.equal(parseArgs(["--models=a", "--no-evict"]).evict, false);
  });

  it("rejects a non-integer repeat count instead of coercing it", () => {
    assert.throws(() => parseArgs(["--models=a", "--repeats=many"]), /integer/);
  });
});

/**
 * Role runners, against a stub provider.
 *
 * These are the composition that turns a model's bytes into a per-role
 * pass/fail — the output the whole exercise exists to produce. A wiring bug
 * here produces a plausible-looking table and sends the wrong model to a role.
 * The leaf scoring helpers above are covered; this covers the assembly.
 */
describe("sage-model-bakeoff role runners", () => {
  const assessReadability = (text: string) => ({
    scorable: text.trim().split(/\s+/).length > 5,
    grade: 5,
  });
  const maxGrade = 8;
  const parseModelJson = (raw: string) => {
    try {
      return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      return null;
    }
  };
  const prompts = { memory: "memory prompt", classroom: "classroom prompt", resume: "resume prompt" };

  function chatProvider(events: Array<Record<string, unknown>>) {
    return {
      async *streamWithTools() {
        for (const event of events) yield event;
      },
    };
  }

  it("passes a chat case when the model calls an acceptable tool", async () => {
    const outcome = await runChatCase(
      { provider: chatProvider([{ kind: "tool_call", name: "present_form" }]), toolDeclarations: [], assessReadability, maxGrade },
      { id: "t", message: "m", expectTool: "search_forms", acceptableTools: ["search_forms", "present_form"] },
    );
    assert.equal(outcome.pass, true);
    assert.equal(outcome.checks.toolSelection, true);
    assert.equal(outcome.detail.picked, "present_form");
  });

  it("fails a chat case when the model calls the wrong tool", async () => {
    const outcome = await runChatCase(
      { provider: chatProvider([{ kind: "tool_call", name: "career_wages" }]), toolDeclarations: [], assessReadability, maxGrade },
      { id: "t", message: "m", expectTool: "search_forms", acceptableTools: ["search_forms"] },
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.toolSelection, false);
  });

  it("fails a chat case when the model calls no tool at all", async () => {
    // The empty-turn failure this repo has hit three separate ways.
    const outcome = await runChatCase(
      { provider: chatProvider([]), toolDeclarations: [], assessReadability, maxGrade },
      { id: "t", message: "m", expectTool: "search_forms" },
    );
    assert.equal(outcome.pass, false);
  });

  it("fails a no-tool case that returns an empty turn", async () => {
    const outcome = await runChatCase(
      { provider: chatProvider([]), toolDeclarations: [], assessReadability, maxGrade },
      { id: "t", message: "m", expectTool: null, mustNotCallAny: true },
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.visibleContent, false);
  });

  it("fails a no-tool case when the model over-triggers a tool", async () => {
    const outcome = await runChatCase(
      {
        provider: chatProvider([
          { kind: "text", text: "Let me look that up for you right now." },
          { kind: "tool_call", name: "career_wages" },
        ]),
        toolDeclarations: [],
        assessReadability,
        maxGrade,
      },
      { id: "t", message: "m", expectTool: null, mustNotCallAny: true },
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.noOverTrigger, false);
  });

  it("never reports a pass with no checks applied", async () => {
    // Object.values({}).every(Boolean) is true — a case that applies no checks
    // would score as a pass and inflate a model's rate.
    for (const testCase of [
      { id: "a", message: "m", expectTool: null },
      { id: "b", message: "m", expectTool: "search_forms" },
    ]) {
      const outcome = await runChatCase(
        { provider: chatProvider([{ kind: "tool_call", name: "search_forms" }]), toolDeclarations: [], assessReadability, maxGrade },
        testCase,
      );
      assert.ok(Object.keys(outcome.checks).length > 0, `case ${testCase.id} applied no checks`);
    }
  });

  function jsonProvider(raw: string) {
    return { generateStructuredResponse: async () => raw };
  }

  it("passes a structured case that conforms and carries the gold fact", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider('{"memories":["takes the bus to class"]}'), prompts, parseModelJson },
      { id: "s", prompt: "memory", expectJsonArrayOf: "memories", expectMinItems: 1, mustContainAny: ["bus"] },
      {},
    );
    assert.equal(outcome.pass, true);
  });

  it("accepts a bare array as well as the wrapper key, matching production", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider('["takes the bus to class"]'), prompts, parseModelJson },
      { id: "s", prompt: "memory", expectJsonArrayOf: "memories", expectMinItems: 1 },
      {},
    );
    assert.equal(outcome.checks.arrayShape, true);
  });

  it("fails and flags truncation when JSON stops mid-structure", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider('{"memories":["takes the bus'), prompts, parseModelJson },
      { id: "s", prompt: "memory", expectJsonArrayOf: "memories", expectMinItems: 1 },
      {},
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.parsesAsJson, false);
    assert.equal(outcome.detail.truncated, true);
  });

  it("fails an empty structured reply rather than scoring it as nothing-to-extract", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider(""), prompts, parseModelJson },
      { id: "s", prompt: "memory", expectJsonArrayOf: "memories" },
      {},
    );
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.visibleContent, false);
  });

  it("catches over-extraction on an empty exchange", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider('{"memories":["a","b","c"]}'), prompts, parseModelJson },
      { id: "s", prompt: "memory", expectJsonArrayOf: "memories", expectMaxItems: 1 },
      {},
    );
    assert.equal(outcome.checks.noOverExtraction, false);
  });

  it("resolves nested field paths against the real contract shape", async () => {
    const outcome = await runStructuredCase(
      {
        provider: jsonProvider('{"resume":{"contact":{},"experience":[]},"improvements":[]}'),
        prompts,
        parseModelJson,
      },
      { id: "d", prompt: "resume", documentFixture: "doc", expectJsonObject: true, expectFields: ["resume.contact", "improvements"] },
      { documentFixtures: { doc: "raw resume text" } },
    );
    assert.equal(outcome.checks.requiredFields, true);
  });

  it("checks a false field value rather than treating it as missing", async () => {
    const outcome = await runStructuredCase(
      { provider: jsonProvider('{"confirmed":false,"confidence":0}'), prompts, parseModelJson },
      { id: "s", prompt: "classroom", expectJsonObject: true, expectFieldValues: { confirmed: false } },
      {},
    );
    assert.equal(outcome.checks.fieldValues, true);
  });

  function proseProvider(text: string) {
    return { generateResponse: async () => text };
  }

  it("passes a draft case inside its length band with the gold fact", async () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ") + " Ridgeline";
    const outcome = await runDraftCase({ provider: proseProvider(text), assessReadability, maxGrade }, {
      id: "d",
      systemPrompt: "s",
      messages: [],
      minWords: 60,
      maxWords: 400,
      mustContainAny: ["Ridgeline"],
    });
    assert.equal(outcome.pass, true);
  });

  it("fails a draft case that is cut short", async () => {
    const outcome = await runDraftCase({ provider: proseProvider("Too short."), assessReadability, maxGrade }, {
      id: "d",
      systemPrompt: "s",
      messages: [],
      minWords: 60,
    });
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.minLength, false);
  });

  it("fails a draft case that loops, even though it passes every length check", async () => {
    const looped = Array(30).fill("you should apply for the job today").join(" ");
    const outcome = await runDraftCase({ provider: proseProvider(looped), assessReadability, maxGrade }, {
      id: "d",
      systemPrompt: "s",
      messages: [],
      minWords: 60,
      maxWords: 400,
    });
    assert.equal(outcome.pass, false);
    assert.equal(outcome.checks.notDegenerate, false);
  });

  it("fails a draft case that leaves a placeholder in", async () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ") + " [EMPLOYER NAME]";
    const outcome = await runDraftCase({ provider: proseProvider(text), assessReadability, maxGrade }, {
      id: "d",
      systemPrompt: "s",
      messages: [],
      minWords: 60,
      mustNotContain: ["[", "]"],
    });
    assert.equal(outcome.checks.noPlaceholders, false);
  });
});
