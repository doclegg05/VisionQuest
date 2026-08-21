import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  containsAny,
  looksTruncated,
  parseArgs,
  repetitionRatio,
  resolveFieldPath,
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
