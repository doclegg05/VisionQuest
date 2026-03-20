import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt, determineStage } from "./system-prompts";

describe("determineStage", () => {
  it("returns onboarding until a BHAG exists", () => {
    assert.equal(determineStage([]), "onboarding");
  });

  it("advances through the staged goal hierarchy", () => {
    assert.equal(determineStage([{ level: "bhag" }]), "monthly");
    assert.equal(determineStage([{ level: "bhag" }, { level: "monthly" }]), "weekly");
    assert.equal(
      determineStage([{ level: "bhag" }, { level: "monthly" }, { level: "weekly" }]),
      "daily"
    );
    assert.equal(
      determineStage([
        { level: "bhag" },
        { level: "monthly" },
        { level: "weekly" },
        { level: "daily" },
      ]),
      "tasks"
    );
    assert.equal(
      determineStage([
        { level: "bhag" },
        { level: "monthly" },
        { level: "weekly" },
        { level: "daily" },
        { level: "task" },
      ]),
      "checkin"
    );
  });
});

describe("buildSystemPrompt", () => {
  it("injects the available context into the stage prompt", () => {
    const prompt = buildSystemPrompt("weekly", {
      studentName: "Avery",
      bhag: "Become a nurse",
      monthly: "Apply to CNA programs",
      weekly: "Finish one application",
    });

    assert.match(prompt, /The student's name is Avery\./);
    assert.match(prompt, /Their BHAG is: "Become a nurse"/);
    assert.match(prompt, /Their monthly goal is: "Apply to CNA programs"/);
    assert.match(prompt, /CURRENT TASK: Help the student set weekly goals/);
  });

  it("includes verified platform status when live student state is provided", () => {
    const prompt = buildSystemPrompt("orientation", {
      student_status_summary: "Required onboarding forms still missing: SPOKES Student Profile.",
    });

    assert.match(prompt, /VERIFIED STUDENT PLATFORM STATUS:/);
    assert.match(prompt, /Required onboarding forms still missing: SPOKES Student Profile\./);
    assert.match(prompt, /Treat this status as factual website state\./);
  });

  it("leaves placeholder-free prompts when optional context is omitted", () => {
    const prompt = buildSystemPrompt("general");

    assert.ok(!prompt.includes("{bhag}"));
    assert.ok(!prompt.includes("{monthly}"));
    assert.match(prompt, /CURRENT TASK: Answer the student's question/);
  });
});
