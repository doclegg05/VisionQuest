import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SAGE_FAILURE_CODES,
  classifyProviderInitFailure,
  classifyStreamFailure,
  cutOffReply,
  isCutOffReply,
  offersRetry,
  savedCutOffReply,
  parseSageFailureCode,
  sageFailureMessage,
  type SageFailureCode,
} from "./sage-failure";

const NOT_LOST = "Your message was not lost.";
const DASHES = /[-‐-―−]/;

describe("sageFailureMessage", () => {
  // What a student reads when the message was saved and Try again shows.
  const studentSaved: Record<SageFailureCode, string> = {
    off: "Sage is off right now. Your message was not lost. Tell your instructor. You can still use the rest of VisionQuest.",
    busy: "Sage is helping other students right now. Your message was not lost. Wait a little, then tap Try again.",
    slow: "Sage is taking too long to answer. Your message was not lost. Tap Try again.",
    not_set_up: "Sage is not set up yet. Your message was not lost. Tell your instructor. You can still use the rest of VisionQuest.",
    unknown: "Sage could not answer this time. Your message was not lost. Tap Try again. If it keeps happening, tell your instructor.",
  };
  const staffUnsaved: Record<SageFailureCode, string> = {
    off: "Sage is off right now. The computer that runs Sage may be off or offline. Tell the person who runs it. You can still use the rest of VisionQuest.",
    busy: "Sage is helping other people right now. Wait a little, then tap Try again.",
    slow: "Sage is taking too long to answer. Tap Try again.",
    not_set_up: "Sage is not set up yet. An admin needs to check the Sage connection settings.",
    unknown: "Sage could not answer this time. Tap Try again. If it keeps happening, tell an admin.",
  };

  for (const code of SAGE_FAILURE_CODES) {
    const canRetry = offersRetry(code);

    it(`gives a student one plain sentence set for ${code}`, () => {
      assert.equal(sageFailureMessage(code, { audience: "student", messageSaved: true, canRetry }), studentSaved[code]);
    });

    it(`gives staff their own sentence set for ${code}`, () => {
      assert.equal(sageFailureMessage(code, { audience: "staff", messageSaved: false, canRetry }), staffUnsaved[code]);
    });

    it(`says the message was not lost for ${code} only when it was saved`, () => {
      const unsaved = sageFailureMessage(code, { audience: "student", messageSaved: false, canRetry });
      assert.ok(!unsaved.includes(NOT_LOST), unsaved);
      assert.equal(unsaved, studentSaved[code].replace(` ${NOT_LOST}`, ""));
    });

    it(`never says Try again for ${code} when no Try again button can show`, () => {
      for (const audience of ["student", "staff"] as const) {
        const text = sageFailureMessage(code, { audience, messageSaved: true, canRetry: false });
        assert.doesNotMatch(text, /Try again/, text);
      }
    });

    it(`uses no dash characters and names no AI key for ${code}`, () => {
      for (const audience of ["student", "staff"] as const) {
        for (const messageSaved of [true, false]) {
          for (const retry of [true, false]) {
            const text = sageFailureMessage(code, { audience, messageSaved, canRetry: retry });
            assert.doesNotMatch(text, DASHES, text);
            assert.doesNotMatch(text, /API|key|Gemini|Ollama|server|relay|local AI|Mac\b/i, text);
          }
        }
      }
    });
  }

  it("offers Try again only where a retry can help: busy, slow and unknown", () => {
    assert.deepEqual(
      SAGE_FAILURE_CODES.filter((code) => offersRetry(code)),
      ["busy", "slow", "unknown"],
    );
  });

  it("never tells a staff member to tell their instructor", () => {
    for (const code of SAGE_FAILURE_CODES) {
      const text = sageFailureMessage(code, { audience: "staff", messageSaved: true, canRetry: offersRetry(code) });
      assert.doesNotMatch(text, /instructor/, text);
    }
  });

  it("does not send staff to Program Setup for settings it does not hold", () => {
    const text = sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false, canRetry: false });
    assert.doesNotMatch(text, /Program Setup/, text);
  });
});

describe("cutOffReply", () => {
  it("adds the fixed cut-off note when Try again can show", () => {
    assert.equal(
      cutOffReply("Here is the first part", "slow", "student"),
      "Here is the first part\n\n(Sage got cut off. Tap Try again for the full answer.)",
    );
  });

  it("says what to do instead when no retry can help", () => {
    const text = cutOffReply("Here is the first part", "off", "student");
    assert.ok(text.startsWith("Here is the first part\n\n(Sage got cut off.)"), text);
    assert.match(text, /Tell your instructor/);
    assert.doesNotMatch(text, /Try again/);
  });
});

describe("classifyStreamFailure", () => {
  const cases: Array<[string, unknown, SageFailureCode]> = [
    ["relay has no Mac (502)", new Error("Local AI stream failed (502)"), "off"],
    ["Cloudflare tunnel down (530)", new Error("Local AI stream failed (530)"), "off"],
    ["connection refused", new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:11437") }), "off"],
    ["connection reset", new Error("upstream connection reset"), "off"],
    ["relay at capacity (503)", new Error("Local AI stream failed (503)"), "busy"],
    ["Ollama queue full", new Error("Ollama returned 503: server busy"), "busy"],
    ["rate limited (429)", new Error("Local AI tool stream failed (429)"), "busy"],
    ["relay timed out (504)", new Error("Local AI stream failed (504)"), "slow"],
    ["Cloudflare timeout (524)", new Error("Local AI request failed (524)"), "slow"],
    ["no first reply in time", new Error("Local AI did not produce a first content token within 45 seconds."), "slow"],
    ["stalled reply", new Error("Local AI stream timed out after 60 seconds with no new content from the model."), "slow"],
    ["whole request timed out", new Error("Local AI request timed out after 300 seconds"), "slow"],
    ["no model configured", new Error("Local AI server URL is not configured. Set it in Program Setup > AI Provider."), "not_set_up"],
    ["model missing (404)", new Error("Local AI stream failed (404)"), "not_set_up"],
    ["token refused (401)", new Error("Local AI stream failed (401)"), "not_set_up"],
    ["a crash (500)", new Error("Local AI stream failed (500)"), "unknown"],
    ["anything else", new Error("kaboom"), "unknown"],
    ["a non-Error throw", "boom", "unknown"],
    ["nothing at all", undefined, "unknown"],
  ];

  for (const [label, error, expected] of cases) {
    it(`maps ${label} to ${expected}`, () => {
      assert.equal(classifyStreamFailure(error), expected);
    });
  }

  it("reads the status, not the words, when a status is reported", () => {
    // A 503 whose cause happens to say "timed out" is still Sage being busy.
    assert.equal(classifyStreamFailure(new Error("Ollama returned 503: request timed out in queue")), "busy");
  });
});

describe("classifyProviderInitFailure", () => {
  it("maps a missing local model URL to not_set_up", () => {
    const error = new Error("Local AI server URL is not configured. Set it in Program Setup > AI Provider.");
    assert.equal(classifyProviderInitFailure(error), "not_set_up");
  });

  it("maps a demo endpoint mismatch to not_set_up", () => {
    const error = new Error("Local AI server does not match the approved demo endpoint origin.");
    assert.equal(classifyProviderInitFailure(error), "not_set_up");
  });

  it("maps a cloud refusal to not_set_up", () => {
    const error = new Error("refused");
    error.name = "AiCloudRefusedError";
    assert.equal(classifyProviderInitFailure(error), "not_set_up");
  });

  it("maps a missing cloud key to not_set_up", () => {
    assert.equal(classifyProviderInitFailure(new Error("Sage is not configured yet.")), "not_set_up");
  });

  it("maps an unreachable server to off", () => {
    assert.equal(classifyProviderInitFailure(new Error("Local AI server unreachable")), "off");
  });

  it("falls back to unknown", () => {
    assert.equal(classifyProviderInitFailure(new Error("database went away")), "unknown");
    assert.equal(classifyProviderInitFailure(42), "unknown");
  });
});

describe("parseSageFailureCode", () => {
  it("reads a known code off an event or body", () => {
    for (const code of SAGE_FAILURE_CODES) {
      assert.equal(parseSageFailureCode({ error: "x", failure: code }), code);
    }
  });

  it("returns null for anything else", () => {
    for (const value of [null, undefined, "off", 3, {}, { failure: "offline" }, { failure: 1 }]) {
      assert.equal(parseSageFailureCode(value), null);
    }
  });
});

describe("savedCutOffReply (E1c 7b)", () => {
  it("saves a cut-off note with no button wording, since a reload shows no Try again", () => {
    for (const code of ["busy", "slow", "unknown"] as const) {
      assert.equal(savedCutOffReply("First part", code, "student"), "First part\n\n(Sage got cut off here.)");
    }
  });

  it("saves the same text as the screen when no retry can help", () => {
    assert.equal(savedCutOffReply("First part", "off", "student"), cutOffReply("First part", "off", "student"));
  });

  it("never says Try again or uses a dash", () => {
    for (const code of SAGE_FAILURE_CODES) {
      const text = savedCutOffReply("x", code, "student");
      assert.doesNotMatch(text, /Try again/, text);
      assert.doesNotMatch(text, DASHES, text);
    }
  });
});

describe("isCutOffReply (E1c 4)", () => {
  it("knows a saved or shown cut-off reply, with or without the 988 block after it", () => {
    for (const code of SAGE_FAILURE_CODES) {
      assert.equal(isCutOffReply(savedCutOffReply("x", code, "student")), true, code);
      assert.equal(isCutOffReply(cutOffReply("x", code, "student") + "\n\nCall or text 988."), true, code);
    }
  });

  it("treats a full answer as an answer", () => {
    assert.equal(isCutOffReply("Here is your full answer."), false);
  });
});

describe("admin wording (E1c 12)", () => {
  it("tells an admin to check Program Setup, which their link opens", () => {
    assert.equal(
      sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false, canRetry: false, isAdmin: true }),
      "Sage is not set up yet. Check the Sage connection settings in Program Setup.",
    );
  });

  it("keeps the other staff and student sentences as they were", () => {
    assert.equal(
      sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false, canRetry: false, isAdmin: false }),
      "Sage is not set up yet. An admin needs to check the Sage connection settings.",
    );
    assert.equal(
      sageFailureMessage("busy", { audience: "staff", messageSaved: false, canRetry: true, isAdmin: true }),
      "Sage is helping other people right now. Wait a little, then tap Try again.",
    );
  });
});
