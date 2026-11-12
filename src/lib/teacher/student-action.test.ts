import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  CHECK_ENTRY_ENDING,
  NO_ACCESS_ENDING,
  NO_ANSWER_ENDING,
  ORIENTATION_NOT_FINISHED,
  OTHER_ENDING,
  SERVER_ENDING,
  SIGNED_OUT_ENDING,
  WAIT_ENDING,
  actionOutcome,
  endingForStatus,
  isWrittenForPeople,
  leadSentence,
  nextNotice,
  orientationOutcome,
  releaseFlag,
  runStudentAction,
  sendStudentAction,
  type Notice,
  type StudentActionRequest,
  type StudentActionResult,
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
      status: 500,
    });
  });

  it("shows the server's reason for a refused request", async () => {
    mockFetch(async () => json(400, { error: "Password must be at least 12 characters." }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} Password must be at least 12 characters.`,
      status: 400,
    });
  });

  // A server default names a status, not a reason. It is never shown; the ending comes from the status.
  const BARE_ANSWERS: [number, string, string][] = [
    [403, "Forbidden", NO_ACCESS_ENDING],
    [403, "Forbidden: origin mismatch.", NO_ACCESS_ENDING],
    [403, "Unauthorized", NO_ACCESS_ENDING],
    [404, "Not found", OTHER_ENDING],
    [400, "Invalid request body.", CHECK_ENTRY_ENDING],
    [400, "Invalid JSON body.", CHECK_ENTRY_ENDING],
    [400, "Bad request", CHECK_ENTRY_ENDING],
    [500, "Internal server error", SERVER_ENDING],
  ];
  for (const [status, bare, ending] of BARE_ANSWERS) {
    it(`never shows the server default "${bare}" (${status})`, async () => {
      mockFetch(async () => json(status, { error: bare }));

      assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${ending}`, status });
    });
  }

  it("says to check the entry for a refused task title, not that our side broke", async () => {
    mockFetch(async () => json(400, { error: "title: String must contain at most 200 character(s)" }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} ${CHECK_ENTRY_ENDING}`,
      status: 400,
    });
  });

  it("says to wait when the server answers too many requests", async () => {
    mockFetch(async () => json(429, { error: "Too many requests, please try again later", code: "RATE_LIMITED" }));

    assert.deepEqual(await sendStudentAction(REQUEST), { ok: false, message: `${FAILED} ${WAIT_ENDING}`, status: 429 });
  });

  it("uses the server ending for a 500 with no body", async () => {
    mockFetch(async () => new Response(null, { status: 500 }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} ${SERVER_ENDING}`,
      status: 500,
    });
  });

  it("uses the server ending when the body is not JSON", async () => {
    mockFetch(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} ${SERVER_ENDING}`,
      status: 502,
    });
  });

  it("uses the server ending for the unhandled-error answer, which is not written for people", async () => {
    mockFetch(async () => json(500, { error: "Something odd happened here.", code: "INTERNAL_ERROR" }));

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} ${SERVER_ENDING}`,
      status: 500,
    });
  });

  it("uses the server ending when the error field is empty or not text", async () => {
    const expected = { ok: false, message: `${FAILED} ${SERVER_ENDING}`, status: 500 };
    mockFetch(async () => json(500, { error: "   " }));
    assert.deepEqual(await sendStudentAction(REQUEST), expected);

    mockFetch(async () => json(500, { error: { detail: "nope" } }));
    assert.deepEqual(await sendStudentAction(REQUEST), expected);
  });

  it("uses the no-answer ending when the network fails, with no status", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    assert.deepEqual(await sendStudentAction(REQUEST), {
      ok: false,
      message: `${FAILED} ${NO_ANSWER_ENDING}`,
      status: null,
    });
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
        status: 401,
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

describe("the endings", () => {
  it("say what to do, in the words the reviews asked for", () => {
    assert.equal(NO_ANSWER_ENDING, "We could not reach VisionQuest. Check your internet, then try again.");
    assert.equal(
      SERVER_ENDING,
      "Something went wrong on our side. Try again in a minute. If it keeps happening, tell your program admin.",
    );
    assert.equal(SIGNED_OUT_ENDING, "Your sign-in ended. Copy what you typed, then sign in again.");
    assert.equal(CHECK_ENTRY_ENDING, "Check what you entered, then try again.");
    assert.equal(NO_ACCESS_ENDING, "You do not have access to do this.");
    assert.equal(WAIT_ENDING, "Wait a minute, then try again.");
    assert.equal(OTHER_ENDING, "Try again. If it keeps happening, tell your program admin.");
  });
});

describe("endingForStatus", () => {
  const CASES: [number, string][] = [
    [400, CHECK_ENTRY_ENDING],
    [409, CHECK_ENTRY_ENDING],
    [422, CHECK_ENTRY_ENDING],
    [403, NO_ACCESS_ENDING],
    [429, WAIT_ENDING],
    [401, SIGNED_OUT_ENDING],
    [500, SERVER_ENDING],
    [502, SERVER_ENDING],
    [503, SERVER_ENDING],
    [404, OTHER_ENDING],
    [405, OTHER_ENDING],
    [413, OTHER_ENDING],
  ];
  for (const [status, ending] of CASES) {
    it(`${status} ends "${ending}"`, () => {
      assert.equal(endingForStatus(status), ending);
    });
  }

  it("blames our side for a 5xx and for nothing else", () => {
    for (let status = 300; status < 600; status += 1) {
      assert.equal(endingForStatus(status) === SERVER_ENDING, status >= 500, String(status));
    }
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
      "Forbidden: origin mismatch.",
      "Not found",
      "Invalid request body.",
      "Invalid JSON body.",
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
    assert.deepEqual(
      actionOutcome({ ok: false, message: "The note was not saved. x", status: 500 }, "Case note saved."),
      {
        notice: { kind: "error", text: "The note was not saved. x" },
        resetForm: false,
        reload: false,
      },
    );
  });
});

describe("nextNotice: an error stays until it is dismissed or a newer error comes", () => {
  const ERROR: Notice = { kind: "error", text: "That step was not verified. Try again." };
  const NEWER_ERROR: Notice = { kind: "error", text: "The note was not saved. Try again." };
  const SUCCESS: Notice = { kind: "success", text: "Case note saved." };
  const NEWER_SUCCESS: Notice = { kind: "success", text: "Task updated." };

  it("shows whatever comes in when nothing is showing", () => {
    assert.equal(nextNotice(null, ERROR), ERROR);
    assert.equal(nextNotice(null, SUCCESS), SUCCESS);
    assert.equal(nextNotice(null, null), null);
  });

  it("a success never replaces an error that is showing", () => {
    assert.equal(nextNotice(ERROR, SUCCESS), ERROR);
  });

  it("the clear at the start of an action never clears an error", () => {
    assert.equal(nextNotice(ERROR, null), ERROR);
  });

  it("a newer error replaces an error", () => {
    assert.equal(nextNotice(ERROR, NEWER_ERROR), NEWER_ERROR);
  });

  it("a success gives way to anything: a clear, a newer success or an error", () => {
    assert.equal(nextNotice(SUCCESS, null), null);
    assert.equal(nextNotice(SUCCESS, NEWER_SUCCESS), NEWER_SUCCESS);
    assert.equal(nextNotice(SUCCESS, ERROR), ERROR);
  });
});

describe("releaseFlag: a finished request clears only its own in-flight flag", () => {
  it("clears the flag when it still holds this request's id", () => {
    assert.equal(releaseFlag("req-1", "req-1"), null);
  });

  it("leaves the flag alone when a later request holds it", () => {
    assert.equal(releaseFlag("req-2", "req-1"), "req-2");
  });

  it("leaves an empty flag empty", () => {
    assert.equal(releaseFlag(null, "req-1"), null);
  });
});

describe("leadSentence: the part of a message shown in bold", () => {
  it("splits what did not happen from why", () => {
    assert.deepEqual(leadSentence("The note was not saved. Check what you entered, then try again."), {
      lead: "The note was not saved.",
      rest: "Check what you entered, then try again.",
    });
  });

  it("keeps every later sentence in the rest", () => {
    assert.deepEqual(leadSentence(`${FAILED} ${SERVER_ENDING}`), { lead: FAILED, rest: SERVER_ENDING });
  });

  it("gives a one-sentence message back whole", () => {
    assert.deepEqual(leadSentence("Case note saved."), { lead: "Case note saved.", rest: "" });
    assert.deepEqual(leadSentence("No full stop here"), { lead: "No full stop here", rest: "" });
  });

  it("ends the lead at a question mark or an exclamation mark too", () => {
    assert.deepEqual(leadSentence("Was it saved? No."), { lead: "Was it saved?", rest: "No." });
  });

  it("does not cut inside a number or a web address", () => {
    assert.deepEqual(leadSentence("Version 2.5 was not saved. Try again."), {
      lead: "Version 2.5 was not saved.",
      rest: "Try again.",
    });
  });
});

describe("orientationOutcome: the finished call after a confirm", () => {
  const STEP_OK: StudentActionResult = { ok: true, payload: null };
  const FINISH_OK: StudentActionResult = { ok: true, payload: { ok: true } };
  const refused = (status: number | null): StudentActionResult => ({
    ok: false,
    message: "Orientation was not marked finished. x",
    status,
  });
  const CONFIRMED = { notice: { kind: "success", text: "Step confirmed." }, resetForm: true, reload: true };
  const NOT_FINISHED = { notice: { kind: "error", text: ORIENTATION_NOT_FINISHED }, resetForm: false, reload: false };

  it("words the failure so it says what did work and what to press", () => {
    assert.equal(
      ORIENTATION_NOT_FINISHED,
      "The step was confirmed, but orientation was not marked finished. Press Confirm again.",
    );
  });

  it("shows the step's own failure when the step was not saved", () => {
    const step: StudentActionResult = { ok: false, message: "That step was not confirmed. x", status: 500 };
    assert.deepEqual(orientationOutcome(step, null, "Step confirmed."), {
      notice: { kind: "error", text: "That step was not confirmed. x" },
      resetForm: false,
      reload: false,
    });
  });

  it("a step sent back has no finished call: it reloads and says so", () => {
    assert.deepEqual(orientationOutcome(STEP_OK, null, "Step sent back to the student."), {
      notice: { kind: "success", text: "Step sent back to the student." },
      resetForm: true,
      reload: true,
    });
  });

  it("a confirm whose finished call worked reloads and says Step confirmed", () => {
    assert.deepEqual(orientationOutcome(STEP_OK, FINISH_OK, "Step confirmed."), CONFIRMED);
  });

  it("keeps ignoring the usual refusal while required steps remain (409)", () => {
    assert.deepEqual(orientationOutcome(STEP_OK, refused(409), "Step confirmed."), CONFIRMED);
  });

  for (const status of [500, 502, 403, 401, 404, 429, null]) {
    it(`shows a failure when the finished call fails another way (${status ?? "no answer"})`, () => {
      assert.deepEqual(orientationOutcome(STEP_OK, refused(status), "Step confirmed."), NOT_FINISHED);
    });
  }
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

describe("runStudentAction on a page that keeps one message by the nextNotice rule", () => {
  const NOTE: StudentActionRequest = {
    url: "/api/teacher/students/s1/notes",
    method: "POST",
    body: { category: "general", body: "Called the student." },
    failed: "The note was not saved.",
    done: "Case note saved.",
  };
  const VERIFY_FAILED: Notice = { kind: "error", text: `${FAILED} ${SERVER_ENDING}` };

  /** A stand-in for StudentDetail: one message, and `notify` applies the rule. */
  function pageWithRule(showing: Notice | null = null) {
    const state = { showing };
    return {
      state,
      notify: (incoming: Notice | null) => {
        state.showing = nextNotice(state.showing, incoming);
      },
      reload: async () => {},
    };
  }

  /** A fetch whose answers the test releases one at a time, to put two actions in a set order. */
  function heldFetch() {
    const release = new Map<string, (response: Response) => void>();
    mock.method(globalThis, "fetch", (url: string | URL | Request) =>
      new Promise<Response>((resolve) => {
        release.set(String(url), resolve);
      }),
    );
    return (url: string, response: Response) => release.get(url)?.(response);
  }

  it("a note saved after a slow failed Verify does not hide the Verify failure", async () => {
    const answer = heldFetch();
    const stub = pageWithRule();

    const verify = runStudentAction(REQUEST, stub);
    const note = runStudentAction(NOTE, stub);
    answer(REQUEST.url, new Response(null, { status: 500 }));
    await verify;
    assert.deepEqual(stub.state.showing, VERIFY_FAILED);

    answer(NOTE.url, json(200, { ok: true }));
    await note;
    assert.deepEqual(stub.state.showing, VERIFY_FAILED);
  });

  it("starting another action does not clear a failure that is showing", async () => {
    mockFetch(async () => json(200, { ok: true }));
    const stub = pageWithRule(VERIFY_FAILED);

    await runStudentAction({ ...NOTE, done: undefined }, stub);

    assert.deepEqual(stub.state.showing, VERIFY_FAILED);
  });

  it("a newer failure replaces the one that is showing", async () => {
    mockFetch(async () => json(400, { error: "Invalid request body." }));
    const stub = pageWithRule(VERIFY_FAILED);

    await runStudentAction(NOTE, stub);

    assert.deepEqual(stub.state.showing, { kind: "error", text: `The note was not saved. ${CHECK_ENTRY_ENDING}` });
  });

  it("an old success is cleared when the next action starts and replaced when it ends", async () => {
    const answer = heldFetch();
    const stub = pageWithRule({ kind: "success", text: "Task updated." });

    const note = runStudentAction(NOTE, stub);
    assert.equal(stub.state.showing, null);
    answer(NOTE.url, json(200, { ok: true }));
    await note;

    assert.deepEqual(stub.state.showing, { kind: "success", text: "Case note saved." });
  });
});
