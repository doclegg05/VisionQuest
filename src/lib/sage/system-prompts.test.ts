import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt, determineStage } from "./system-prompts";

describe("determineStage", () => {
  it("returns discovery when no goals and no completed discovery", () => {
    assert.equal(determineStage([], false), "discovery");
  });

  it("returns discovery when hasCompletedDiscovery is undefined and no goals", () => {
    assert.equal(determineStage([]), "discovery");
  });

  it("returns onboarding when discovery is complete but no BHAG", () => {
    assert.equal(determineStage([], true), "onboarding");
  });

  it("skips discovery when BHAG exists even without completed discovery", () => {
    assert.equal(determineStage([{ level: "bhag" }], false), "monthly");
  });

  it("advances through the staged goal hierarchy", () => {
    assert.equal(determineStage([{ level: "bhag" }], true), "monthly");
    assert.equal(determineStage([{ level: "bhag" }, { level: "monthly" }], true), "weekly");
    assert.equal(
      determineStage([{ level: "bhag" }, { level: "monthly" }, { level: "weekly" }], true),
      "daily"
    );
    assert.equal(
      determineStage([
        { level: "bhag" },
        { level: "monthly" },
        { level: "weekly" },
        { level: "daily" },
      ], true),
      "tasks"
    );
    assert.equal(
      determineStage([
        { level: "bhag" },
        { level: "monthly" },
        { level: "weekly" },
        { level: "daily" },
        { level: "task" },
      ], true),
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
    assert.match(prompt, /\[STUDENT_GOAL_START\]Become a nurse\[STUDENT_GOAL_END\]/);
    assert.match(prompt, /\[STUDENT_GOAL_START\]Apply to CNA programs\[STUDENT_GOAL_END\]/);
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

  it("injects career clusters into discovery stage prompt", () => {
    const prompt = buildSystemPrompt("discovery", {
      studentName: "Jordan",
      career_clusters: "SPOKES CAREER PATHWAYS:\nOffice & Admin\nFinance & Bookkeeping",
    });

    assert.match(prompt, /Career Discovery/);
    assert.match(prompt, /SPOKES CAREER PATHWAYS:/);
    assert.match(prompt, /Office & Admin/);
    assert.match(prompt, /The student's name is Jordan/);
  });

  it("injects discovery summary into non-discovery stages", () => {
    const prompt = buildSystemPrompt("onboarding", {
      discovery_summary: "Student is interested in office work and bookkeeping. (Top pathways: office-admin, finance-bookkeeping)",
    });

    assert.match(prompt, /CAREER DISCOVERY CONTEXT/);
    assert.match(prompt, /interested in office work/);
  });

  it("does not inject discovery summary into discovery stage itself", () => {
    const prompt = buildSystemPrompt("discovery", {
      career_clusters: "test clusters",
      discovery_summary: "This should not appear",
    });

    assert.ok(!prompt.includes("CAREER DISCOVERY CONTEXT"));
  });

  it("builds a teacher assistant prompt with all three roles", () => {
    const prompt = buildSystemPrompt("teacher_assistant", {
      studentName: "Ms. Carter",
      userMessage: "How do I set up GMetrix accounts?",
    });

    // Should include teacher-specific content
    assert.match(prompt, /ROLE 1 — PROGRAM KNOWLEDGE ASSISTANT/);
    assert.match(prompt, /ROLE 2 — STUDENT ADVISOR/);
    assert.match(prompt, /ROLE 3 — GENERAL ASSISTANT/);
    assert.match(prompt, /Professional and collegial/);
  });

  it("teacher assistant prompt excludes student personality and guardrails", () => {
    const prompt = buildSystemPrompt("teacher_assistant", {
      userMessage: "Tell me about IC3",
    });

    // Should NOT include student-focused personality or guardrails
    assert.ok(!prompt.includes("You believe every one of them has unrealized potential"));
    assert.ok(!prompt.includes("MOTIVATIONAL INTERVIEWING PRINCIPLES"));
    assert.ok(!prompt.includes("call 988"));

    // Should include platform and program knowledge
    assert.match(prompt, /SPOKES PROGRAM KNOWLEDGE BASE/);
    assert.match(prompt, /PLATFORM MODULES/);
  });

  it("teacher assistant prompt injects relevant topic content based on userMessage", () => {
    const prompt = buildSystemPrompt("teacher_assistant", {
      userMessage: "How do I set up GMetrix for a new student?",
    });

    assert.match(prompt, /DETAILED REFERENCE/);
    assert.match(prompt, /GMETRIX/i);
  });

  it("teacher assistant prompt works without userMessage", () => {
    const prompt = buildSystemPrompt("teacher_assistant", {});

    assert.match(prompt, /ROLE 1 — PROGRAM KNOWLEDGE ASSISTANT/);
    assert.ok(!prompt.includes("DETAILED REFERENCE"));
  });
});
