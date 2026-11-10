import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseSendErrorBody,
  prepareRetry,
  resolveSendError,
  resolveStreamOutcome,
  SageSendError,
  type SendErrorContext,
} from "./send-outcome";
import { CUT_OFF_NOTE, SAGE_FAILURE_CODES, cutOffReply, offersRetry, sageFailureMessage } from "./sage-failure";

const CRISIS_BLOCK = "\n\nIf you are in crisis, call or text 988.";
const STUDENT: SendErrorContext = { priorContent: "", audience: "student", isAdmin: false, savedUserMessageId: null };

function serverError(code: (typeof SAGE_FAILURE_CODES)[number], crisisBlock: string | null = null) {
  const text = sageFailureMessage(code, { audience: "student", messageSaved: true, canRetry: offersRetry(code) });
  return new SageSendError(text + (crisisBlock ?? ""), code, { crisisBlock, userMessageId: "msg-saved-1" });
}

describe("resolveStreamOutcome", () => {
  it("offers retry and a plain-language fallback when the stream produced zero content", () => {
    for (const completed of [true, false]) {
      const outcome = resolveStreamOutcome(completed, "");
      assert.equal(outcome.offerRetry, true);
      assert.equal(outcome.keepOnRetry, false);
      assert.equal(outcome.content, "Sage did not send an answer. Your message was not lost. Tap Try again.");
    }
  });

  it("keeps partial content, marked as cut off, when the stream did not finish", () => {
    const outcome = resolveStreamOutcome(false, "Here's what I found so far");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.keepOnRetry, true);
    assert.equal(outcome.content, `Here's what I found so far\n\n${CUT_OFF_NOTE}`);
  });

  it("does not offer retry when the stream completed with content", () => {
    const outcome = resolveStreamOutcome(true, "All done!");
    assert.equal(outcome.offerRetry, false);
    assert.equal(outcome.content, "All done!");
  });
});

describe("resolveSendError", () => {
  it("shows the server's sentence once and offers Try again", () => {
    const err = serverError("busy");
    const outcome = resolveSendError(err, STUDENT);
    assert.equal(outcome.displayContent, err.message);
    assert.equal(outcome.failure, "busy");
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.alert, true);
  });

  it("(4) offers no Try again when Sage is off or not set up", () => {
    for (const code of ["off", "not_set_up"] as const) {
      const outcome = resolveSendError(serverError(code), STUDENT);
      assert.equal(outcome.offerRetry, false, code);
      assert.doesNotMatch(outcome.displayContent, /Try again/);
      assert.match(outcome.displayContent, /Tell your instructor\. You can still use the rest of VisionQuest\./);
    }
  });

  it("(1) keeps a partial reply, cut off, with the 988 block after it", () => {
    const outcome = resolveSendError(serverError("slow", CRISIS_BLOCK), { ...STUDENT, priorContent: "First part" });
    assert.equal(outcome.displayContent, cutOffReply("First part", "slow", "student") + CRISIS_BLOCK);
    assert.equal(outcome.offerRetry, true);
    assert.equal(outcome.keepOnRetry, true);
    assert.equal(outcome.alert, false);
  });

  it("(2) shows Try again whenever the words say to tap it, and never otherwise", () => {
    const errors: unknown[] = [...SAGE_FAILURE_CODES.map((code) => serverError(code)), new TypeError("Failed to fetch")];
    for (const err of errors) {
      for (const priorContent of ["", "partial text"]) {
        const outcome = resolveSendError(err, { ...STUDENT, priorContent });
        assert.equal(/Try again/.test(outcome.displayContent), outcome.offerRetry, outcome.displayContent);
      }
    }
  });

  for (const code of SAGE_FAILURE_CODES) {
    it(`(3) keeps the server's 988 block for a student on ${code}, and keeps the bubble on retry`, () => {
      const err = serverError(code, CRISIS_BLOCK);
      const outcome = resolveSendError(err, STUDENT);
      assert.equal(outcome.displayContent, err.message);
      assert.ok(outcome.displayContent.endsWith(CRISIS_BLOCK));
      assert.equal(outcome.keepOnRetry, true);
    });
  }

  it("drops a plain failure bubble on retry", () => {
    assert.equal(resolveSendError(serverError("busy"), STUDENT).keepOnRetry, false);
  });

  it("(6) carries the saved message's id so Try again can point at it", () => {
    assert.equal(resolveSendError(serverError("busy"), STUDENT).retryOf, "msg-saved-1");
    const fromStream = resolveSendError(new TypeError("network"), { ...STUDENT, savedUserMessageId: "msg-stream-2" });
    assert.equal(fromStream.retryOf, "msg-stream-2");
    assert.equal(resolveSendError(new TypeError("network"), STUDENT).retryOf, null);
  });

  it("(5) a network drop shows the fixed sentence, and says not lost only when the stream said it was saved", () => {
    for (const err of [new TypeError("Failed to fetch"), "boom", undefined]) {
      const outcome = resolveSendError(err, STUDENT);
      assert.equal(
        outcome.displayContent,
        sageFailureMessage("unknown", { audience: "student", messageSaved: false, canRetry: true }),
      );
      assert.equal(outcome.failure, "unknown");
      assert.equal(outcome.offerRetry, true);
    }
    const saved = resolveSendError(new TypeError("x"), { ...STUDENT, savedUserMessageId: "m1" });
    assert.match(saved.displayContent, /Your message was not lost/);
  });

  it("never gives a student API-key instructions or a setup link", () => {
    const outcome = resolveSendError(serverError("not_set_up"), STUDENT);
    assert.doesNotMatch(outcome.displayContent, /API|key|Settings/i);
    assert.equal(outcome.setupLink, false);
  });

  it("(11) links only an admin to Program Setup when Sage is not set up", () => {
    const staff = { ...STUDENT, audience: "staff" as const };
    assert.equal(resolveSendError(serverError("not_set_up"), { ...staff, isAdmin: true }).setupLink, true);
    assert.equal(resolveSendError(serverError("not_set_up"), staff).setupLink, false);
    assert.equal(resolveSendError(serverError("off"), { ...staff, isAdmin: true }).setupLink, false);
  });

  it("shows a rate limit as the server wrote it, with no Try again", () => {
    const err = parseSendErrorBody(429, { error: "Too many messages this hour. Please wait before sending more." });
    const outcome = resolveSendError(err, STUDENT);
    assert.equal(outcome.displayContent, "Too many messages this hour. Please wait before sending more.");
    assert.equal(outcome.failure, null);
    assert.equal(outcome.offerRetry, false);
  });
});

describe("parseSendErrorBody", () => {
  it("(5) hides server text that carries no failure code behind the fixed sentence", () => {
    for (const [status, body] of [
      [500, { error: "Internal server error" }],
      [400, { error: "Message too long. Maximum 10,000 characters." }],
      [502, null],
      [500, { error: 42, failure: "busy" }],
    ] as const) {
      const outcome = resolveSendError(parseSendErrorBody(status, body), STUDENT);
      assert.equal(
        outcome.displayContent,
        sageFailureMessage("unknown", { audience: "student", messageSaved: false, canRetry: true }),
        `${status}`,
      );
    }
  });

  it("keeps the server's text, code, 988 block and saved id when a code is present", () => {
    const err = parseSendErrorBody(500, {
      error: "Sage could not answer this time." + CRISIS_BLOCK,
      failure: "unknown",
      crisisBlock: CRISIS_BLOCK,
      userMessageId: "m9",
    });
    assert.ok(err instanceof SageSendError);
    assert.equal(err.failure, "unknown");
    assert.equal(err.crisisBlock, CRISIS_BLOCK);
    assert.equal(err.userMessageId, "m9");
  });
});

describe("prepareRetry", () => {
  const messages = [
    { id: "u0", role: "user" as const, content: "first" },
    { id: "a0", role: "assistant" as const, content: "reply" },
    { id: "u1", role: "user" as const, content: "second" },
    { id: "err-1", role: "assistant" as const, content: "Sage is busy.", failure: { keepOnRetry: false, retryOf: "m1" } },
  ];

  it("drops a plain failure and keeps the question, which the retry answers", () => {
    const prepared = prepareRetry(messages, "err-1");
    assert.deepEqual(prepared, { messages: messages.slice(0, 3), text: "second", retryOf: "m1" });
  });

  it("(3) keeps a failure that carries the 988 block or a partial reply", () => {
    const kept = messages.map((m) => (m.id === "err-1" ? { ...m, failure: { keepOnRetry: true, retryOf: null } } : m));
    const prepared = prepareRetry(kept, "err-1");
    assert.deepEqual(prepared?.messages, kept);
    assert.equal(prepared?.retryOf, null);
  });

  it("does not change the list it was given", () => {
    const copy = messages.map((message) => ({ ...message }));
    prepareRetry(messages, "err-1");
    assert.deepEqual(messages, copy);
  });

  it("returns null when the failed message or its question is gone", () => {
    assert.equal(prepareRetry(messages, "missing"), null);
    assert.equal(prepareRetry([{ id: "err-1", role: "assistant", content: "x" }], "err-1"), null);
  });
});
