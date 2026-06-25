import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readinessBand,
  renderSituationalSnapshot,
  type SituationalSnapshotInput,
} from "./situational-snapshot";

const base: SituationalSnapshotInput = {
  readinessScore: 42,
  level: 2,
  xp: 320,
  currentStreak: 4,
  certsEarned: 2,
  orientation: { completed: 5, total: 7 },
  strongest: "Certifications",
  weakest: "Resume & Portfolio",
  activeGoals: [
    { level: "bhag", content: "Become a CNA and work at the local hospital" },
    { level: "weekly", content: "Finish one job application" },
  ],
  stalledGoalCount: 1,
  nextAppointment: { title: "Advising session", when: "Mon, Jun 29, 2:30 PM" },
};

describe("readinessBand", () => {
  it("maps scores to plain-language bands", () => {
    assert.equal(readinessBand(10), "Just getting started");
    assert.equal(readinessBand(42), "Building momentum");
    assert.equal(readinessBand(60), "On track");
    assert.equal(readinessBand(80), "Nearly ready");
    assert.equal(readinessBand(95), "Ready to work");
  });
});

describe("renderSituationalSnapshot", () => {
  it("includes a factual header that instructs personalization", () => {
    const out = renderSituationalSnapshot(base);
    assert.match(out, /WHERE THIS STUDENT IS RIGHT NOW/);
    assert.match(out, /treat as factual/i);
    assert.match(out, /Never ask for something already shown here/);
  });

  it("renders readiness, level, streak, certs, orientation, goals, and next appointment", () => {
    const out = renderSituationalSnapshot(base);
    assert.match(out, /Readiness: 42\/100 \(Building momentum\)/);
    assert.match(out, /Level 2, 320 XP, 4-day streak/);
    assert.match(out, /Strength: Certifications\. Biggest opportunity: Resume & Portfolio\./);
    assert.match(out, /Certifications earned: 2/);
    assert.match(out, /Orientation: 5\/7 required steps done/);
    assert.match(out, /BHAG — Become a CNA/);
    assert.match(out, /1 goal has stalled/);
    assert.match(out, /Next appointment: Advising session on Mon, Jun 29, 2:30 PM/);
  });

  it("omits the streak clause when there is no streak", () => {
    const out = renderSituationalSnapshot({ ...base, currentStreak: 0 });
    assert.ok(!out.includes("-day streak"));
    assert.match(out, /Level 2, 320 XP\./);
  });

  it("handles a brand-new student with no goals, certs, or appointment", () => {
    const out = renderSituationalSnapshot({
      readinessScore: 3,
      level: 1,
      xp: 0,
      currentStreak: 0,
      certsEarned: 0,
      orientation: { completed: 0, total: 7 },
      strongest: null,
      weakest: null,
      activeGoals: [],
      stalledGoalCount: 0,
      nextAppointment: null,
    });
    assert.match(out, /Just getting started/);
    assert.match(out, /No active goals set yet/);
    assert.ok(!out.includes("stalled"));
    assert.ok(!out.includes("Next appointment"));
    assert.ok(!out.includes("Strength:"));
  });

  it("truncates a very long goal so the snapshot stays compact", () => {
    const longGoal = "x".repeat(200);
    const out = renderSituationalSnapshot({ ...base, activeGoals: [{ level: "bhag", content: longGoal }] });
    assert.match(out, /…/);
    assert.ok(!out.includes("x".repeat(200)));
  });
});
