import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openPrintWindow, pageNonce, withStyleNonce } from "./resume-print";

/**
 * Resume Print failed for every student: it opened the print window with
 * "noopener,noreferrer", and per the HTML spec window.open returns null when
 * noopener is set, so the code always took its "Pop-up blocked" branch.
 * Reproduced in a real browser on 2026-10-09.
 *
 * The fake opener models that spec rule, so re-adding noopener fails here.
 */

interface FakeWindow {
  opener: unknown;
  written: string[];
  document: { open(): void; write(html: string): void; close(): void };
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = {
    opener: { app: "visionquest" },
    written: [],
    document: {
      open() {},
      write(html: string) {
        win.written.push(html);
      },
      close() {},
    },
  };
  return win;
}

function specOpener(win: FakeWindow) {
  const calls: string[] = [];
  const open = (_url?: string, _target?: string, features?: string) => {
    calls.push(features ?? "");
    return /noopener/i.test(features ?? "") ? null : (win as unknown as Window);
  };
  return { open, calls };
}

describe("openPrintWindow", () => {
  it("returns a window it wrote the resume into", () => {
    const win = fakeWindow();
    const { open } = specOpener(win);

    const result = openPrintWindow("<p>resume</p>", open);

    assert.ok(result, "a browser that follows the spec must still hand back a window");
    assert.deepEqual(win.written, ["<p>resume</p>"]);
  });

  it("severs the opener link itself instead of asking for noopener", () => {
    const win = fakeWindow();
    const { open, calls } = specOpener(win);

    openPrintWindow("<p>resume</p>", open);

    assert.ok(!/noopener/i.test(calls[0]), `noopener makes window.open return null; got "${calls[0]}"`);
    assert.equal(win.opener, null, "the print window must not keep a reference back to the app");
  });

  it("returns null when the browser really does block the window", () => {
    const blocked = () => null;

    assert.equal(openPrintWindow("<p>resume</p>", blocked), null);
  });
});

describe("withStyleNonce", () => {
  it("stamps the nonce on every <style> tag", () => {
    assert.equal(
      withStyleNonce('<style>a{}</style><style media="print">b{}</style>', "abc+/="),
      '<style nonce="abc+/=">a{}</style><style nonce="abc+/=" media="print">b{}</style>',
    );
  });

  it("leaves the html alone without a usable nonce", () => {
    assert.equal(withStyleNonce("<style>a{}</style>", undefined), "<style>a{}</style>");
    assert.equal(withStyleNonce("<style>a{}</style>", '" onload="x'), "<style>a{}</style>");
  });
});

describe("pageNonce", () => {
  it("reads the nonce property, which browsers keep after hiding the attribute", () => {
    const doc = { querySelector: () => ({ nonce: "n0nce" }) } as unknown as Document;
    assert.equal(pageNonce(doc), "n0nce");
  });

  it("is undefined when no element carries one", () => {
    const doc = { querySelector: () => null } as unknown as Document;
    assert.equal(pageNonce(doc), undefined);
  });
});
