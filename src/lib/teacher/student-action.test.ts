import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { runStudentAction, sendStudentAction, type StudentActionRequest } from "./student-action";

/**
 * The instructor's student page sent its writes and never looked at the
 * answer. A Verify that failed reloaded the page unchanged, so the instructor
 * could not tell it from one that worked, and grant reports count only
 * verified outcomes. These tests pin the one helper every write now goes
 * through: a response that is not ok always comes back as a message.
 */

const FALLBACK = "That step was not verified. Check your connection and try again.";

const REQUEST: StudentActionRequest = {
  url: "/api/teacher/certifications",
  method: "PUT",
  body: { requirementId: "req-1", verified: true },
  fallback: FALLBACK,
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

  it("returns the server's message for a 500 that carries one", async () => {
    mockFetch(async () => json(500, { error: "The archive could not be written." }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: "The archive could not be written.",
    });
  });

  it("returns the server's reason for a refused request", async () => {
    mockFetch(async () => json(400, { error: "Password must be at least 12 characters" }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: "Password must be at least 12 characters",
    });
  });

  it("falls back to the plain sentence for a 500 with no body", async () => {
    mockFetch(async () => new Response(null, { status: 500 }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
  });

  it("falls back when the body is not JSON", async () => {
    mockFetch(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
  });

  it("falls back for the server's unhandled-error answer, which is not written for people", async () => {
    // What withErrorHandler sends for any error it did not expect.
    mockFetch(async () => json(500, { error: "Internal server error", code: "INTERNAL_ERROR" }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
  });

  it("falls back when the error field is empty or not text", async () => {
    mockFetch(async () => json(500, { error: "   " }));
    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });

    mockFetch(async () => json(500, { error: { detail: "nope" } }));
    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
  });

  it("falls back when the network fails", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
  });

  it("logs the kind of failure and nothing that could name a student", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed for /api/teacher/students/stu-1/status");
    });

    await sendStudentAction({ ...REQUEST, url: "/api/teacher/students/stu-1/status" });

    assert.deepEqual(logged, [["Student action got no answer:", "TypeError"]]);
  });

  it("sends the browser to sign-in when the session has ended", async () => {
    // Node has no window; the redirect needs somewhere to write.
    const location = { href: "/teacher/students/s1" };
    Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
    mockFetch(async () => json(401, { error: "Unauthorized" }));

    try {
      assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: FALLBACK });
      assert.equal(location.href, "/");
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("sends no body and no JSON header when there is nothing to send", async () => {
    const fetchMock = mockFetch(async () => json(200, { ok: true }));

    await sendStudentAction({ url: "/api/teacher/students/s1/archive", method: "POST", fallback: FALLBACK });

    const [, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(init?.body, undefined);
    assert.equal(init?.headers, undefined);
  });
});

describe("runStudentAction", () => {
  /** A stand-in for the page: records banner messages and reloads. */
  function page() {
    const events: string[] = [];
    return {
      events,
      report: (message: string | null) => {
        events.push(message === null ? "clear" : `banner: ${message}`);
      },
      reload: async () => {
        events.push("reload");
      },
    };
  }

  it("shows the failure and does not reload, because nothing changed", async () => {
    mockFetch(async () => json(500, { error: "Only completed requirements can be verified." }));
    const stub = page();

    const result = await runStudentAction(REQUEST, stub);

    assert.deepEqual(stub.events, ["clear", "banner: Only completed requirements can be verified."]);
    assert.equal(result.ok, false);
  });

  it("shows the plain sentence when the network fails", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const stub = page();

    await runStudentAction(REQUEST, stub);

    assert.deepEqual(stub.events, ["clear", `banner: ${FALLBACK}`]);
  });

  it("clears an old message and reloads once when the action works", async () => {
    mockFetch(async () => json(200, { ok: true }));
    const stub = page();

    const result = await runStudentAction(REQUEST, stub);

    assert.deepEqual(stub.events, ["clear", "reload"]);
    assert.equal(result.ok, true);
  });
});
