import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { CRISIS_RESOURCE_BLOCK, CRISIS_RESOURCE_BLOCK_ES } from "@/lib/chat/crisis-safety-net";
import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import {
  SLOW_REPLY_MS,
  SLOW_REPLY_WORDS,
  STOPPED_NOTE,
  showsCannedOpener,
  startSlowReplyTimer,
  stoppedTurnMessages,
  withEarlyCrisisHelp,
} from "./wait-and-stop";
import type { ChatMessage } from "./failed-turn";

const DASHES = /[-‐-―−]/;

afterEach(() => {
  mock.timers.reset();
});

describe("the words under the dots (E2.1)", () => {
  it("wait five seconds", () => {
    assert.equal(SLOW_REPLY_MS, 5000);
  });

  it("call back once at five seconds, not before", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const onSlow = mock.fn();
    startSlowReplyTimer(onSlow);
    mock.timers.tick(4999);
    assert.equal(onSlow.mock.callCount(), 0);
    mock.timers.tick(1);
    assert.equal(onSlow.mock.callCount(), 1);
    mock.timers.tick(60_000);
    assert.equal(onSlow.mock.callCount(), 1);
  });

  it("never call back once cancelled (the first word came, or a new send)", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const onSlow = mock.fn();
    const cancel = startSlowReplyTimer(onSlow);
    mock.timers.tick(3000);
    cancel();
    mock.timers.tick(10_000);
    assert.equal(onSlow.mock.callCount(), 0);
  });

  it("are plain, short and dash free", () => {
    assert.doesNotMatch(SLOW_REPLY_WORDS, DASHES);
    assert.ok(SLOW_REPLY_WORDS.split(/\s+/).length <= 10, SLOW_REPLY_WORDS);
    const grade = assessReadability(SLOW_REPLY_WORDS, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(grade.withinTarget, JSON.stringify(grade));
  });
});

describe("a turn the student stopped (E2.2)", () => {
  it("keeps the streamed text as Sage's reply, with the stopped note and no failure", () => {
    const [reply, ...rest] = stoppedTurnMessages({ id: "m1", partial: "Here is the first part", events: [], crisisBlock: null });
    assert.equal(rest.length, 0);
    assert.equal(reply.role, "assistant");
    assert.equal(reply.content, `Here is the first part\n\n${STOPPED_NOTE}`);
    assert.equal(reply.failure, undefined);
  });

  it("keeps tool chips that streamed before the stop", () => {
    const events = [{ id: "t1", kind: "tool" as const, summary: "Checking goals..." }];
    const [reply] = stoppedTurnMessages({ id: "m1", partial: "Part", events, crisisBlock: null });
    assert.deepEqual(reply.events, events);
  });

  it("with nothing streamed, shows only the stopped note", () => {
    const messages = stoppedTurnMessages({ id: "m1", partial: "", events: [], crisisBlock: null });
    assert.deepEqual(messages.map((m) => m.content), [STOPPED_NOTE]);
    assert.equal(messages[0].failure, undefined);
  });

  it("shows the 988 help on its own when the server flagged a crisis message", () => {
    for (const block of [CRISIS_RESOURCE_BLOCK, CRISIS_RESOURCE_BLOCK_ES]) {
      for (const partial of ["", "I hear you. Let's"]) {
        const messages = stoppedTurnMessages({ id: "m1", partial, events: [], crisisBlock: block });
        const help = messages.at(-1)!;
        assert.equal(messages.length, 2);
        assert.equal(help.id, "m1-help");
        assert.equal(help.content, block.replace(/^\n+/, ""));
        assert.equal(help.failure, undefined);
      }
    }
  });

  it("adds no second 988 help when the streamed text already has 988", () => {
    const messages = stoppedTurnMessages({
      id: "m1",
      partial: "Please call or text 988 right now.",
      events: [],
      crisisBlock: CRISIS_RESOURCE_BLOCK,
    });
    assert.equal(messages.length, 1);
  });

  it("note is plain and dash free", () => {
    assert.doesNotMatch(STOPPED_NOTE, DASHES);
    const grade = assessReadability(STOPPED_NOTE, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(grade.withinTarget, JSON.stringify(grade));
  });
});

describe("a dropped connection after a crisis message (E2.2 safety)", () => {
  const failed: ChatMessage = {
    id: "e1",
    role: "assistant",
    content: "Sage could not answer. Your message was not lost. Tap Try again.",
    failure: { keepOnRetry: false, retryOf: "u1", alert: true },
  };

  it("adds the 988 help bubble the server flagged on the first event", () => {
    const messages = withEarlyCrisisHelp([failed], CRISIS_RESOURCE_BLOCK, "e1");
    assert.equal(messages.length, 2);
    assert.equal(messages[0], failed);
    assert.equal(messages[1].id, "e1-help");
    assert.match(messages[1].content, /call or text 988/);
    assert.equal(messages[1].failure, undefined);
  });

  it("leaves the turn alone when it already shows 988", () => {
    const withHelp = [failed, { id: "e1-help", role: "assistant" as const, content: CRISIS_RESOURCE_BLOCK.trim() }];
    assert.deepEqual(withEarlyCrisisHelp(withHelp, CRISIS_RESOURCE_BLOCK, "e1"), withHelp);
  });

  it("leaves the turn alone with no crisis flag", () => {
    assert.deepEqual(withEarlyCrisisHelp([failed], null, "e1"), [failed]);
  });
});

describe("the canned opener (E2.3)", () => {
  it("shows on a student's first message only when Sage is not on the local model", () => {
    assert.equal(showsCannedOpener({ role: "student", isFirstMessage: true, localProvider: false }), true);
    assert.equal(showsCannedOpener({ role: "student", isFirstMessage: true, localProvider: true }), false);
    assert.equal(showsCannedOpener({ role: "student", isFirstMessage: false, localProvider: false }), false);
    assert.equal(showsCannedOpener({ role: "teacher", isFirstMessage: true, localProvider: false }), false);
  });
});
