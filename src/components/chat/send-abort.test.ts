import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { CRISIS_RESOURCE_BLOCK } from "@/lib/chat/crisis-safety-net";
import { createSendAbort, useSendAbort } from "./send-abort";
import { messagesAfterSendError } from "./send-turn";
import { STOP_ARM_DELAY_MS, STOPPED_NOTE } from "./wait-and-stop";

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});

afterEach(() => {
  mock.timers.reset();
});

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

describe("the Stop gate (E2b 1 and 2)", () => {
  it("does not abort before the first event's ids, so the 988 help is not lost", () => {
    const armedChanges: boolean[] = [];
    const gate = createSendAbort((armed) => armedChanges.push(armed));
    const controller = gate.begin();
    mock.timers.tick(STOP_ARM_DELAY_MS * 10);
    gate.stop();
    assert.equal(controller.signal.aborted, false);
    assert.equal(gate.wasStopped(), false);
    assert.equal(gate.armed(), false);
    assert.ok(!armedChanges.includes(true));
  });

  it("does nothing on a second tap right after Send, even once the ids are in", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    gate.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS - 1);
    gate.stop();
    assert.equal(controller.signal.aborted, false);
    assert.equal(gate.armed(), false);
  });

  it("arms when the ids are in and 800 ms have passed, in either order", () => {
    const early = createSendAbort(() => undefined);
    early.begin();
    early.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    assert.equal(early.armed(), true);

    const late = createSendAbort(() => undefined);
    late.begin();
    mock.timers.tick(STOP_ARM_DELAY_MS * 3);
    assert.equal(late.armed(), false);
    late.noteIds();
    assert.equal(late.armed(), true);
  });

  it("tells the chat each time the armed state changes", () => {
    const armedChanges: boolean[] = [];
    const gate = createSendAbort((armed) => armedChanges.push(armed));
    const controller = gate.begin();
    gate.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    gate.end(controller);
    assert.deepEqual(armedChanges.filter((armed, i) => armed !== armedChanges[i - 1]), [false, true, false]);
  });

  it("a crisis message: Stop before the ids does nothing; after them, Stop shows the 988 help", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    gate.stop();
    assert.equal(controller.signal.aborted, false);

    // The first event: ids, then the crisis flag (chat-stream.ts applyEvent).
    gate.noteIds();
    const crisisBlock = CRISIS_RESOURCE_BLOCK;
    mock.timers.tick(STOP_ARM_DELAY_MS);
    gate.stop();
    assert.equal(controller.signal.aborted, true);
    assert.equal(gate.wasStopped(), true);

    const after = messagesAfterSendError({
      err: abortError(), stopped: gate.wasStopped(), partial: "", events: [], crisisBlock,
      role: "student", savedUserMessageId: "u1", id: "s1",
    });
    assert.deepEqual(after.messages.map((m) => m.content), [STOPPED_NOTE, crisisBlock.replace(/^\n+/, "")]);
  });

  it("a new send starts unarmed and not stopped", () => {
    const gate = createSendAbort(() => undefined);
    const first = gate.begin();
    gate.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    gate.stop();
    gate.end(first);
    const second = gate.begin();
    assert.equal(gate.wasStopped(), false);
    assert.equal(gate.armed(), false);
    gate.stop();
    assert.equal(second.signal.aborted, false);
  });

  it("an old send ending leaves the new send's controller alone", () => {
    const gate = createSendAbort(() => undefined);
    const first = gate.begin();
    const second = gate.begin();
    gate.end(first);
    gate.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    gate.stop();
    assert.equal(second.signal.aborted, true);
  });
});

describe("a Stop after 800 ms but before the ids (E2c 2)", () => {
  it("is kept, and ends the reply when the ids arrive; a crisis message still shows the 988 help", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    mock.timers.tick(900);
    gate.stop();
    assert.equal(controller.signal.aborted, false, "nothing to abort before the ids");

    // The first event: ids, then the crisis flag (chat-stream.ts applyEvent).
    gate.noteIds();
    const crisisBlock = CRISIS_RESOURCE_BLOCK;
    assert.equal(controller.signal.aborted, true);
    assert.equal(gate.wasStopped(), true);

    const after = messagesAfterSendError({
      err: abortError(),
      stopped: gate.wasStopped(),
      partial: "",
      events: [],
      crisisBlock,
      role: "student",
      savedUserMessageId: "u1",
      id: "s1",
    });
    assert.deepEqual(after.messages.map((m) => m.content), [STOPPED_NOTE, crisisBlock.replace(/^\n+/, "")]);
  });

  it("a tap under 800 ms (a double tap on Send) is still ignored once the ids arrive", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    mock.timers.tick(500);
    gate.stop();
    gate.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    assert.equal(controller.signal.aborted, false);
    assert.equal(gate.wasStopped(), false);
  });

  it("a kept Stop does not carry over to the next send", () => {
    const gate = createSendAbort(() => undefined);
    const first = gate.begin();
    mock.timers.tick(900);
    gate.stop();
    gate.end(first);
    const second = gate.begin();
    gate.noteIds();
    assert.equal(second.signal.aborted, false);
    assert.equal(gate.wasStopped(), false);
  });
});

describe("useSendAbort (E2c 5)", () => {
  it("returns the gate itself and isArmed beside it, so arming leaves the gate's identity alone", () => {
    function Probe() {
      const result = useSendAbort();
      return createElement("output", {
        "data-keys": Object.keys(result).sort().join(","),
        "data-armed": String(result.isArmed),
        "data-gate": [typeof result.gate.begin, typeof result.gate.stop].join(","),
      });
    }
    const html = renderToString(createElement(Probe));
    assert.match(html, /data-keys="gate,isArmed"/);
    assert.match(html, /data-armed="false"/);
    assert.match(html, /data-gate="function,function"/);
  });
});
