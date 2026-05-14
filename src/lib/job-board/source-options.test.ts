import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JOB_SOURCES,
  JOB_SOURCE_OPTIONS,
  VALID_JOB_SOURCES,
  isValidJobSource,
} from "./source-options";

describe("job source options", () => {
  it("keeps default sources in the valid source registry", () => {
    for (const source of DEFAULT_JOB_SOURCES) {
      assert.equal(isValidJobSource(source), true);
    }
  });

  it("includes the Job Scout no-key sources", () => {
    assert.ok(VALID_JOB_SOURCES.includes("remotive"));
    assert.ok(VALID_JOB_SOURCES.includes("remoteok"));
    assert.ok(VALID_JOB_SOURCES.includes("weworkremotely"));
    assert.ok(VALID_JOB_SOURCES.includes("greenhouse"));
    assert.ok(VALID_JOB_SOURCES.includes("lever"));
    assert.ok(VALID_JOB_SOURCES.includes("ashby"));
  });

  it("keeps the options unique and aligned with the valid source registry", () => {
    const optionValues = JOB_SOURCE_OPTIONS.map((source) => source.value);

    assert.deepEqual([...new Set(optionValues)], optionValues);
    assert.deepEqual(VALID_JOB_SOURCES, optionValues);
    assert.ok(JOB_SOURCE_OPTIONS.every((source) => ["local", "remote", "mixed"].includes(source.sourceMode)));
  });

  it("marks remote-first sources separately from local sources", () => {
    const remotive = JOB_SOURCE_OPTIONS.find((source) => source.value === "remotive");
    const jsearch = JOB_SOURCE_OPTIONS.find((source) => source.value === "jsearch");

    assert.equal(remotive?.sourceMode, "remote");
    assert.equal(jsearch?.sourceMode, "local");
  });

  it("rejects unknown sources", () => {
    assert.equal(isValidJobSource("linkedin"), false);
    assert.equal(isValidJobSource(""), false);
  });
});
