import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  NO_ANSWER_ENDING,
  SERVER_ENDING,
  SIGNED_OUT_ENDING,
  actionOutcome,
  isWrittenForPeople,
  runStudentAction,
  sendStudentAction,
  type Notice,
  type StudentActionRequest,
} from "./student-action";

/**
 * The instructor's student page sent its writes and never looked at the
 * answer. A Verify that failed reloaded the page unchanged, so the instructor
 * could not tell it from one that worked, and grant reports count only
 * verified outcomes. These tests pin the one helper every write now goes
 * through: a response that is not ok always comes back as a message that
 * says what did not happen, then why.
 */

const FAILED = "That step was not verified.";

const REQUEST: StudentActionRequest = {
  url: "/api/teacher/certifications",
  method: "PUT",
  body: { requirementId: "req-1", verified: true },
  failed: FAILED,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Replaces the global fetch for one test and records what it was asked. */
function mockFetch(respond: () => Promise<Response>) {
  return mock.method(globalThis, "fetch", respond);
}

/** What the helper wrote to the console in the current test. */
let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  mock.restoreAll();
});

describe("sendStudentAction", () => {
  it("sends the method, the JSON body and the JSON header", async () => {
    const fetchMock = mockFetch(async () => json(200, { ok: true }));

    await sendStudentAction(REQUEST);

    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, "/api/teacher/certifications");
    assert.equal(init?.method, "PUT");
    assert.equal(init?.body, JSON.stringify({ requirementId: "req-1", verified: true }));
    assert.deepEqual(init?.headers, { "Content-Type": "application/json" });
  });

  it("returns the parsed answer when the server says ok", async () => {
    mockFetch(async () => json(200, { ok: true, isActive: false }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: true,
      payload: { ok: true, isActive: false },
    });
  });

  it("counts an ok answer with no body as done", async () => {
    mockFetch(async () => new Response(null, { status: 204 }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: true, payload: null });
  });

  it("leads with what did not happen, then the server's own sentence", async () => {
    mockFetch(async () => json(500, { error: "The archive could not be written." }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} The archive could not be written.`,
    });
  });

  it("shows the server's reason for a refused request", async () => {
    mockFetch(async () => json(400, { error: "Password must be at least 12 characters." }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} Password must be at least 12 characters.`,
    });
  });

  for (const bare of ["Forbidden", "Not found", "Unauthorized", "Invalid request body.", "Internal server error"]) {
    it(`hides the bare server default "${bare}" behind the server ending`, async () => {
      mockFetch(async () => json(403, { error: bare }));

      assert.deepEqual(await sendStudentAction(REQUEST), {
        ok: false,
        message: `${FAILED} ${SERVER_ENDING}`,
      });
    });
  }

  it("uses the server ending for a 500 with no body", async () => {
    mockFetch(async () => new Response(null, { status: 500 }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${SERVER_ENDING}` });
  });

  it("uses the server ending when the body is not JSON", async () => {
    mockFetch(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${SERVER_ENDING}` });
  });

  it("uses the server ending for the unhandled-error answer, which is not written for people", async () => {
    mockFetch(async () => json(500, { error: "Something odd happened here.", code: "INTERNAL_ERROR" }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${SERVER_ENDING}` });
  });

  it("uses the server ending when the error field is empty or not text", async () => {
    mockFetch(async () => json(500, { error: "   " }));
    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${SERVER_ENDING}` });

    mockFetch(async () => json(500, { error: { detail: "nope" } }));
    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${SERVER_ENDING}` });
  });

  it("uses the no-answer ending when the network fails", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${NO_ANSWER_ENDING}` });
  });

  it("logs the kind of failure and nothing that could name a student", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed for /api/teacher/students/stu-1/status");
    });

    await sendStudentAction({ ...REQUEST, url: "/api/teacher/students/stu-1/status" });

    assert.deepEqual(logged, [["Student action got no answer:", "TypeError"]]);
  });

  it("stays on the page when the sign-in has ended, so typed work is not lost", async () => {
    const location = { href: "/teacher/students/s1" };
    Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
    mockFetch(async () => json(401, { error: "Unauthorized" }));

    try {
      assert.deepEqual(await sendStudentAction(REQUEST), {
        ok: false,
        message: `${FAILED} ${SIGNED_OUT_ENDING}`,
      });
      assert.equal(location.href, "/teacher/students/s1");
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("sends no body and no JSON header when there is nothing to send", async () => {
    const fetchMock = mockFetch(async () => json(200, { ok: true }));

    await sendStudentAction({ url: "/api/teacher/students/s1/archive", method: "POST", failed: FAILED });

    const [, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(init?.body, undefined);
    assert.equal(init?.headers, undefined);
  });
});

describe("the three endings", () => {
  it("say what to do, in the words the reviews asked for", () => {
    assert.equal(NO_ANSWER_ENDING, "We could not reach VisionQuest. Check your internet, then try again.");
    assert.equal(
      SERVER_ENDING,
      "Something went wrong on our side. Try again in a minute. If it keeps happening, tell your program admin.",
    );
    assert.equal(SIGNED_OUT_ENDING, "Your sign-in ended. Copy what you typed, then sign in again.");
  });
});

describe("isWrittenForPeople", () => {
  it("accepts a sentence a person wrote", () => {
    assert.equal(isWrittenForPeople("Only completed requirements can be verified."), true);
    assert.equal(isWrittenForPeople("Password must be at least 12 characters."), true);
  });

  it("rejects machine text", () => {
    for (const text of [
      "Forbidden",
      "Not found",
      "Invalid request body.",
      "Internal server error",
      "requirementId: Required",
      "Expected string, received number",
      "P2002 unique constraint",
      "{\"code\":\"x\"}",
      "invalid_type at body.status.",
    ]) {
      assert.equal(isWrittenForPeople(text), false, text);
    }
  });
});

describe("actionOutcome", () => {
  it("on success: shows the done line, resets the form and reloads", () => {
    assert.deepEqual(actionOutcome({ ok: true, payload: null }, "Case note saved."), {
      notice: { kind: "success", text: "Case note saved." },
      resetForm: true,
      reload: true,
    });
  });

  it("on success with no done line: clears the message", () => {
    assert.deepEqual(actionOutcome({ ok: true, payload: null }), {
      notice: null,
      resetForm: true,
      reload: true,
    });
  });

  it("can word the done line from the server's answer", () => {
    const outcome = actionOutcome({ ok: true, payload: { count: 2 } }, (payload) =>
      typeof payload === "object" && payload !== null && "count" in payload ? `Saved ${String(payload.count)}.` : "Saved.",
    );
    assert.deepEqual(outcome.notice, { kind: "success", text: "Saved 2." });
  });

  it("on failure: shows the error, keeps what was typed, does not reload", () => {
    assert.deepEqual(actionOutcome({ ok: false, message: "The note was not saved. x" }, "Case note saved."), {
      notice: { kind: "error", text: "The note was not saved. x" },
      resetForm: false,
      reload: false,
    });
  });
});

describe("runStudentAction", () => {
  /** A stand-in for the page: records messages and reloads. */
  function page() {
    const events: string[] = [];
    return {
      events,
      notify: (notice: Notice | null) => {
        events.push(notice === null ? "clear" : `${notice.kind}: ${notice.text}`);
      },
      reload: async () => {
        events.push("reload");
      },
    };
  }

  it("shows the failure and does not reload, because nothing changed", async () => {
    mockFetch(async () => json(500, { error: "Only completed requirements can be verified." }));
    const stub = page();

    const outcome = await runStudentAction(REQUEST, stub);

    assert.deepEqual(stub.events, ["clear", `error: ${FAILED} Only completed requirements can be verified.`]);
    assert.equal(outcome.resetForm, false);
  });

  it("shows the no-answer sentence when the network fails", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const stub = page();

    await runStudentAction(REQUEST, stub);

    assert.deepEqual(stub.events, ["clear", `error: ${FAILED} ${NO_ANSWER_ENDING}`]);
  });

  it("clears an old message, reloads once, then shows the done line", async () => {
    mockFetch(async () => json(200, { ok: true }));
    const stub = page();

    const outcome = await runStudentAction({ ...REQUEST, done: "Step verified." }, stub);

    assert.deepEqual(stub.events, ["clear", "reload", "success: Step verified."]);
    assert.equal(outcome.resetForm, true);
  });
});
