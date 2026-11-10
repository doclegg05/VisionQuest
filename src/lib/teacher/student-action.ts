/**
 * One way to send a write from the instructor's student page.
 *
 * The page used to send its requests and never read the answer. A Verify that
 * failed reloaded the page unchanged, so the instructor could not tell it from
 * one that worked, and grant reports count only verified outcomes. Every write
 * on that page goes through here, so a failure always comes back as a message
 * that says what did not happen and then why. `StudentDetail.action-errors.test.tsx`
 * fails if a write skips it.
 */

export interface StudentActionRequest {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  /** Sent as JSON. Leave out for a request with no body. */
  body?: unknown;
  /** What did not happen, as one sentence: "The note was not saved." Every failure starts with it. */
  failed: string;
  /** Shown when it worked. A function words it from the server's answer. Leave out to show nothing. */
  done?: DoneLine;
}

export type DoneLine = string | ((payload: unknown) => string);

export type StudentActionResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string };

/** A message for the instructor. `origin` lets the page clear a reset failure when the field is edited. */
export interface Notice {
  kind: "error" | "success";
  text: string;
  origin?: "reset";
}

/** What the page does after an action: the message to show, and whether to clear the form and reload. */
export interface ActionOutcome {
  /** `null` clears the message. */
  notice: Notice | null;
  resetForm: boolean;
  reload: boolean;
}

/** The two things an action needs from the page it runs on. */
export interface StudentActionPage {
  notify: (notice: Notice | null) => void;
  reload: () => Promise<void>;
}

/** No answer came back at all. */
export const NO_ANSWER_ENDING = "We could not reach VisionQuest. Check your internet, then try again.";

/** The server answered with an error and gave no sentence a person can use. */
export const SERVER_ENDING =
  "Something went wrong on our side. Try again in a minute. If it keeps happening, tell your program admin.";

/**
 * The sign-in ended. `apiFetch` would send the browser to `/` here, and a long
 * case note would be lost, so this helper stays on the page and says so.
 */
export const SIGNED_OUT_ENDING = "Your sign-in ended. Copy what you typed, then sign in again.";

/** The code `withErrorHandler` puts on an error it did not expect. Its message is never for people. */
const UNHANDLED_ERROR_CODE = "INTERNAL_ERROR";

/** Server defaults that name a status, not a reason. Compared without case or a closing period. */
const BARE_DEFAULTS = new Set([
  "forbidden",
  "not found",
  "unauthorized",
  "invalid request body",
  "internal server error",
  "bad request",
]);

/** Characters and shapes that only machine text has: ids, field paths, JSON, camelCase. */
const MACHINE_TEXT = /[_{}[\]<>=]|[a-z][A-Z]|\b\w+\.\w+\b/u;

/**
 * True when a server message is a sentence written for people: it starts with
 * a capital, ends like a sentence, has a few words and no machine text.
 */
export function isWrittenForPeople(text: string): boolean {
  const trimmed = text.trim();
  const bare = trimmed.replace(/\.$/u, "").toLowerCase();
  if (BARE_DEFAULTS.has(bare)) return false;
  if (!/^[A-Z]/u.test(trimmed) || !/[.!?]$/u.test(trimmed)) return false;
  if (trimmed.split(/\s+/u).length < 3) return false;
  return !MACHINE_TEXT.test(trimmed);
}

/** The server's own sentence for what went wrong, when it sent one worth showing. */
function serverSentence(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if ("code" in payload && payload.code === UNHANDLED_ERROR_CODE) return null;
  if (!("error" in payload) || typeof payload.error !== "string") return null;
  return isWrittenForPeople(payload.error) ? payload.error.trim() : null;
}

/** The JSON body, or null when there is none. An empty or HTML body is not an error here. */
async function readJson(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return null;
  }
}

function failure(request: StudentActionRequest, reason: string): StudentActionResult {
  return { ok: false, message: `${request.failed} ${reason}` };
}

/**
 * Sends one write and reports how it went. Never throws and never leaves the
 * page: a dropped connection, an expired sign-in and an answer that is not ok
 * all come back as `{ ok: false, message }`.
 */
export async function sendStudentAction(request: StudentActionRequest): Promise<StudentActionResult> {
  const hasBody = request.body !== undefined;
  let response: Response;
  try {
    // Plain fetch, not apiFetch: apiFetch leaves the page on a 401.
    response = await fetch(request.url, {
      method: request.method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
  } catch (error: unknown) {
    // Only the error's name is logged: no URL and no body, because both can carry a student's id.
    console.error("Student action got no answer:", error instanceof Error ? error.name : "unknown");
    return failure(request, NO_ANSWER_ENDING);
  }
  const payload = await readJson(response);
  if (response.ok) return { ok: true, payload };
  if (response.status === 401) return failure(request, SIGNED_OUT_ENDING);
  return failure(request, serverSentence(payload) ?? SERVER_ENDING);
}

/** What the page shows and does after one action. Pure, so a broken handler fails a unit test. */
export function actionOutcome(result: StudentActionResult, done?: DoneLine): ActionOutcome {
  if (!result.ok) {
    return { notice: { kind: "error", text: result.message }, resetForm: false, reload: false };
  }
  const text = typeof done === "function" ? done(result.payload) : done;
  return {
    notice: text ? { kind: "success", text } : null,
    resetForm: true,
    reload: true,
  };
}

/**
 * Sends one write for the page. A failure is shown and the page is left as it
 * is, because nothing changed. A success reloads the student, then shows the
 * done line.
 */
export async function runStudentAction(
  request: StudentActionRequest,
  page: StudentActionPage,
): Promise<ActionOutcome> {
  page.notify(null);
  const outcome = actionOutcome(await sendStudentAction(request), request.done);
  if (outcome.reload) await page.reload();
  page.notify(outcome.notice);
  return outcome;
}
