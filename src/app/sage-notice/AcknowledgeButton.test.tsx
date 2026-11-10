import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import {
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_SIGNED_OUT,
  SAGE_NOTICE_ACK_STALE,
  SAGE_NOTICE_SIGN_IN_AGAIN,
  SAGE_NOTICE_VERSION,
} from "@/lib/about-sage/notice";
import { followOutcome, outcomeForStatus, postAcknowledgement, type AckRouter } from "./acknowledge";
import { AcknowledgeMessage } from "./AcknowledgeButton";
import { signOutThen } from "./SignOutBlock";

function recordingRouter(): AckRouter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    replace: (path: string) => calls.push(`replace ${path}`),
    refresh: () => calls.push("refresh"),
  };
}

describe("outcomeForStatus", () => {
  it("reads the route's answers", () => {
    assert.equal(outcomeForStatus(200), "saved");
    // 400: the body's version is not the current one, so this tab is stale.
    assert.equal(outcomeForStatus(400), "stale");
    assert.equal(outcomeForStatus(401), "signed-out");
    assert.equal(outcomeForStatus(500), "failed");
    assert.equal(outcomeForStatus(429), "failed");
  });
});

describe("postAcknowledgement", () => {
  it("posts the current version and reads the status", async () => {
    let sent: { url: string; body: string } | null = null;
    const outcome = await postAcknowledgement(async (url, init) => {
      sent = { url: String(url), body: String(init?.body) };
      return new Response(null, { status: 400 });
    });
    assert.equal(outcome, "stale");
    assert.deepEqual(sent, { url: "/api/sage-notice", body: JSON.stringify({ version: SAGE_NOTICE_VERSION }) });
  });

  it("treats a network failure as a failed save the student can retry", async () => {
    const outcome = await postAcknowledgement(async () => {
      throw new TypeError("network down");
    });
    assert.equal(outcome, "failed");
  });
});

describe("followOutcome", () => {
  it("goes to the dashboard and drops the old render on success", () => {
    const router = recordingRouter();
    followOutcome("saved", router);
    assert.deepEqual(router.calls, ["replace /dashboard", "refresh"]);
  });

  it("reloads the page when the notice changed, so the current words show", () => {
    const router = recordingRouter();
    followOutcome("stale", router);
    assert.deepEqual(router.calls, ["refresh"]);
  });

  it("stays put on a failure or a signed-out answer", () => {
    for (const outcome of ["failed", "signed-out"] as const) {
      const router = recordingRouter();
      followOutcome(outcome, router);
      assert.deepEqual(router.calls, [], outcome);
    }
  });
});

describe("AcknowledgeMessage", () => {
  it("shows nothing before a tap or after a save", () => {
    assert.equal(renderToString(<AcknowledgeMessage outcome={null} />), "");
    assert.equal(renderToString(<AcknowledgeMessage outcome="saved" />), "");
  });

  it("shows each problem as an alert with a soft danger fill and an icon", () => {
    const cases = [
      ["failed", SAGE_NOTICE_ACK_FAILED],
      ["stale", SAGE_NOTICE_ACK_STALE],
      ["signed-out", SAGE_NOTICE_ACK_SIGNED_OUT],
    ] as const;
    for (const [outcome, words] of cases) {
      const html = renderToString(<AcknowledgeMessage outcome={outcome} />);
      assert.match(html, /^<p role="alert" class="[^"]*bg-danger-soft[^"]*"/, outcome);
      assert.match(html, /<svg[^>]*aria-hidden="true"/, outcome);
      assert.ok(html.includes(words), outcome);
    }
  });

  it("gives a signed-out student a link to sign in again", () => {
    const html = renderToString(<AcknowledgeMessage outcome="signed-out" />);
    assert.match(html, new RegExp(`<a[^>]*href="/"[^>]*>${SAGE_NOTICE_SIGN_IN_AGAIN}</a>`));
    assert.doesNotMatch(renderToString(<AcknowledgeMessage outcome="failed" />), /<a\b/);
  });
});

describe("signOutThen", () => {
  it("ends the session, then leaves", async () => {
    const calls: string[] = [];
    await signOutThen(async (url, init) => {
      calls.push(`${init?.method} ${String(url)}`);
      return new Response(null, { status: 200 });
    }, () => calls.push("leave"));
    assert.deepEqual(calls, ["DELETE /api/auth/session", "leave"]);
  });

  it("leaves whatever the server said", async () => {
    const calls: string[] = [];
    await signOutThen(async () => new Response(null, { status: 500 }), () => calls.push("leave"));
    assert.deepEqual(calls, ["leave"]);
  });
});
