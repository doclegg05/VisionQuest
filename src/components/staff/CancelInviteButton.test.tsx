import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { CancelInviteButtonView, runOnce } from "./CancelInviteButton";

// MEMORY Known Issues: a confirm-style button that ignores its in-flight state
// gets tapped again. A second tap can land before React re-renders the
// disabled button, so the handler needs its own re-entry guard.

describe("runOnce", () => {
  it("runs the action once for two taps that land before it settles", async () => {
    const ref = { current: false };
    let calls = 0;
    let release: () => void = () => {};
    const action = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const first = runOnce(ref, action);
    const second = runOnce(ref, action);
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });

  it("allows a retry once the first attempt failed", async () => {
    const ref = { current: false };
    let calls = 0;
    await runOnce(ref, async () => {
      calls += 1;
      throw new Error("network");
    }).catch(() => {});
    await runOnce(ref, async () => {
      calls += 1;
    });
    assert.equal(calls, 2);
  });
});

describe("CancelInviteButtonView", () => {
  it("reads Cancel invite and is enabled when idle", () => {
    const html = renderToString(<CancelInviteButtonView pending={false} onClick={() => {}} />);
    assert.match(html, />Cancel invite</);
    assert.doesNotMatch(html, /disabled=""/);
  });

  it("changes its label and disables itself while the cancel is in flight", () => {
    const html = renderToString(<CancelInviteButtonView pending onClick={() => {}} />);
    assert.match(html, />Canceling…</);
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-busy="true"/);
  });
});
