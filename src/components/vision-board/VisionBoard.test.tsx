import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { deletePin, reinsertPin, type VisionBoardItemData } from "./VisionBoard";

/**
 * HIG review C-47: removing a pin hides it at once, sends the DELETE after the
 * undo window, and puts the pin back if the request fails. The request must
 * report failure so the undo queue can restore the pin and explain why.
 */

function pin(id: string): VisionBoardItemData {
  return {
    id,
    type: "note",
    content: `Note ${id}`,
    fileId: null,
    goalId: null,
    posX: 0,
    posY: 0,
    width: 20,
    rotation: 0,
    color: "yellow",
    pinColor: "red",
    zIndex: 1,
  };
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("deletePin", () => {
  it("sends a keepalive DELETE for the pin so it survives a tab close", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await deletePin("pin-1");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/vision-board");
    assert.equal(calls[0].init?.method, "DELETE");
    assert.equal(calls[0].init?.keepalive, true);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { id: "pin-1" });
  });

  it("rejects when the server refuses, so the pin is restored instead of silently lost", async () => {
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ error: "Item not found." }), { status: 500 }));
    await assert.rejects(() => deletePin("pin-1"));
  });

  it("rejects when the network fails", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await assert.rejects(() => deletePin("pin-1"));
  });
});

describe("reinsertPin", () => {
  it("puts the pin back where it was", () => {
    const a = pin("a");
    const b = pin("b");
    const c = pin("c");
    assert.deepEqual(reinsertPin([a, c], b, 1).map((p) => p.id), ["a", "b", "c"]);
  });

  it("does not duplicate a pin that is already back", () => {
    const a = pin("a");
    const b = pin("b");
    const list = [a, b];
    assert.equal(reinsertPin(list, b, 1), list);
  });

  it("appends when the old position is past the end of the list", () => {
    const a = pin("a");
    const b = pin("b");
    assert.deepEqual(reinsertPin([a], b, 5).map((p) => p.id), ["a", "b"]);
  });
});
