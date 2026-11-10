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
  // The version comes from the server's render of the page, not from the
  // copy of the code in the browser, so a refresh after a stale answer sends
  // the version the student is now reading.
  it("posts the version the page was rendered with", async () => {
    let body = "";
    await postAcknowledgement("2099-01-01", async (_url, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    });
    assert.equal(body, JSON.stringify({ version: "2099-01-01" }));
  });

  it("posts the current version and reads the status", async () => {
    let sent: { url: string; body: string } | null = null;
    const outcome = await postAcknowledgement(SAGE_NOTICE_VERSION, async (url, init) => {
      sent = { url: String(url), body: String(init?.body) };
      return new Response(null, { status: 400 });
    });
    assert.equal(outcome, "stale");
    assert.deepEqual(sent, { url: "/api/sage-notice", body: JSON.stringify({ version: SAGE_NOTICE_VERSION }) });
  });

  it("treats a network failure as a failed save the student can retry", async () => {
    const outcome = await postAcknowledgement(SAGE_NOTICE_VERSION, async () => {
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
    const left = await signOutThen(async (url, init) => {
      calls.push(`${init?.method} ${String(url)}`);
      return new Response(null, { status: 200 });
    }, () => calls.push("leave"));
    assert.equal(left, true);
    assert.deepEqual(calls, ["DELETE /api/auth/session", "leave"]);
  });

  // A shared classroom computer: if the server did not end the session, the
  // cookie is still good, so leaving for the sign-in page would hand the
  // next person this student's account.
  it("stays when the server did not end the session", async () => {
    const calls: string[] = [];
    const left = await signOutThen(async () => new Response(null, { status: 500 }), () => calls.push("leave"));
    assert.equal(left, false);
    assert.deepEqual(calls, []);
  });

  it("stays when the request never got an answer, and does not throw", async () => {
    const calls: string[] = [];
    const left = await signOutThen(async () => {
      throw new TypeError("Failed to fetch");
    }, () => calls.push("leave"));
    assert.equal(left, false);
    assert.deepEqual(calls, []);
  });

  it("does not count a 401 from something in between as signed out", async () => {
    const calls: string[] = [];
    const left = await signOutThen(async () => new Response(null, { status: 401 }), () => calls.push("leave"));
    assert.equal(left, false);
    assert.deepEqual(calls, []);
  });
});
