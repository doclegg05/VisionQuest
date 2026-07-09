import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  determineStage,
  messageHasLogisticsIntent,
  promptStageForMessage,
} from "./stage";

describe("determineStage", () => {
  it("returns discovery when no BHAG and discovery incomplete", () => {
    assert.equal(determineStage([], false), "discovery");
  });
});

describe("messageHasLogisticsIntent", () => {
  it("detects form and appointment asks", () => {
    assert.equal(messageHasLogisticsIntent("show me the student profile form"), true);
    assert.equal(messageHasLogisticsIntent("I need to book an appointment"), true);
    assert.equal(messageHasLogisticsIntent("help with my portfolio"), true);
  });

  it("rejects open goal talk", () => {
    assert.equal(messageHasLogisticsIntent("I want a better life someday"), false);
  });
});

describe("promptStageForMessage", () => {
  it("overrides discovery to orientation for form asks", () => {
    assert.equal(
      promptStageForMessage("discovery", "show me the student profile form"),
      "orientation",
    );
  });

  it("overrides discovery to general for appointment asks", () => {
    assert.equal(
      promptStageForMessage("discovery", "can I book an advising appointment?"),
      "general",
    );
  });

  it("keeps discovery for open career talk", () => {
    assert.equal(
      promptStageForMessage("discovery", "I like working with people"),
      "discovery",
    );
  });

  it("does not override checkin", () => {
    assert.equal(
      promptStageForMessage("checkin", "show me the student profile form"),
      "checkin",
    );
  });

  it("uses hasFormMatch even without strong logistics words", () => {
    assert.equal(
      promptStageForMessage("onboarding", "student profile", { hasFormMatch: true }),
      "orientation",
    );
  });
});
