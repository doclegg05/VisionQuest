import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";

import { abortable, linkedController } from "../abort";

// E9b 7: one turn's signal is shared by every provider fetch on that turn.
// Linking must not leave a listener on it per call, or a long tool turn
// trips MaxListenersExceededWarning and keeps every request's controller alive.

describe("linkedController (E9b 7)", () => {
  it("leaves no abort listener on the caller's signal after 20 calls", () => {
    const turn = new AbortController();
    const links = Array.from({ length: 20 }, () => linkedController(turn.signal));
    assert.equal(getEventListeners(turn.signal, "abort").length, 0);
    assert.ok(links.every((link) => !link.signal.aborted));
  });

  it("still aborts every request when the caller's signal does", () => {
    const turn = new AbortController();
    const links = Array.from({ length: 3 }, () => linkedController(turn.signal));
    turn.abort(new Error("stop"));
    assert.ok(links.every((link) => link.signal.aborted));
  });

  it("aborts on its own deadline without touching the caller's signal", () => {
    const turn = new AbortController();
    const link = linkedController(turn.signal);
    link.abort(new Error("deadline"));
    assert.equal(link.signal.aborted, true);
    assert.equal(turn.signal.aborted, false);
  });

  it("throws at once for a signal already aborted", () => {
    const turn = new AbortController();
    turn.abort();
    assert.throws(() => linkedController(turn.signal));
  });

  it("works with no caller signal", () => {
    const link = linkedController(undefined);
    link.abort();
    assert.equal(link.signal.aborted, true);
  });
});

describe("abortable (E9b 5)", () => {
  it("rejects with an AbortError as soon as the signal aborts, without waiting for the work", async () => {
    const turn = new AbortController();
    const stalled = new Promise<string>(() => undefined);
    const raced = abortable(stalled, turn.signal);
    turn.abort();
    await assert.rejects(raced, (error: unknown) => error instanceof Error && error.name === "AbortError");
  });

  it("passes the work's value and error through, and removes its listener after", async () => {
    const turn = new AbortController();
    assert.equal(await abortable(Promise.resolve("ok"), turn.signal), "ok");
    await assert.rejects(abortable(Promise.reject(new Error("boom")), turn.signal), /boom/);
    assert.equal(getEventListeners(turn.signal, "abort").length, 0);
  });

  it("rejects at once for a signal already aborted", async () => {
    const turn = new AbortController();
    turn.abort();
    await assert.rejects(abortable(Promise.resolve("late"), turn.signal), { name: "AbortError" });
  });
});
