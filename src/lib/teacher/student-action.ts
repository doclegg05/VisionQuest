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

/** On a failure, `status` is the status the server answered with, or null when no answer came back. */
export type StudentActionResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string; status: number | null };

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
  /** Called with null when an action starts, then with its message. The page applies `nextNotice`. */
  notify: (notice: Notice | null) => void;
  reload: () => Promise<void>;
}

/** No answer came back at all. */
export const NO_ANSWER_ENDING = "We could not reach VisionQuest. Check your internet, then try again.";

/** The server failed (a 5xx) and gave no sentence a person can use. Other statuses have their own ending. */
export const SERVER_ENDING =
  "Something went wrong on our side. Try again in a minute. If it keeps happening, tell your program admin.";

/**
 * The sign-in ended. `apiFetch` would send the browser to `/` here, and a long
 * case note would be lost, so this helper stays on the page and says so.
 */
export const SIGNED_OUT_ENDING = "Your sign-in ended. Copy what you typed, then sign in again.";

/** The server refused what was sent: a value is wrong, or the record changed since the page loaded. */
export const CHECK_ENTRY_ENDING = "Check what you entered, then try again.";

/** The server says this instructor may not do this. */
export const NO_ACCESS_ENDING = "You do not have access to do this.";

/** Too many requests in a short time. */
export const WAIT_ENDING = "Wait a minute, then try again.";

/** Any other refusal, such as a record that is gone. It blames nobody, because the cause is not known. */
export const OTHER_ENDING = "Try again. If it keeps happening, tell your program admin.";

/**
 * Shown when a step was confirmed but the call that marks orientation
 * finished failed. It does not say "or reload the page": a reload takes the
 * Confirm button away, and that button is the only way to send the call again.
 */
export const ORIENTATION_NOT_FINISHED =
  "The step was confirmed, but orientation was not marked finished. Press Confirm again.";

/** What `/api/orientation/complete` answers while required steps remain. The usual answer, not a failure. */
const STEPS_REMAIN_STATUS = 409;

/** The code `withErrorHandler` puts on an error it did not expect. Its message is never for people. */
const UNHANDLED_ERROR_CODE = "INTERNAL_ERROR";

/** Server defaults that name a status, not a reason. Compared without case or a closing period. */
const BARE_DEFAULTS = new Set([
  "forbidden",
  "forbidden: origin mismatch",
  "not found",
  "unauthorized",
  "invalid request body",
  "invalid json body",
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

/**
 * The ending for an answer that is not ok and carries no sentence a person
 * can use. Only a 5xx says the fault is on our side: a title that is too long
 * (400) or a missing permission (403) is not, and saying so sends the
 * instructor to an admin for something they can fix themselves.
 */
export function endingForStatus(status: number): string {
  if (status === 400 || status === 409 || status === 422) return CHECK_ENTRY_ENDING;
  if (status === 401) return SIGNED_OUT_ENDING;
  if (status === 403) return NO_ACCESS_ENDING;
  if (status === 429) return WAIT_ENDING;
  if (status >= 500) return SERVER_ENDING;
  return OTHER_ENDING;
}

function failure(request: StudentActionRequest, reason: string, status: number | null): StudentActionResult {
  return { ok: false, message: `${request.failed} ${reason}`, status };
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
    return failure(request, NO_ANSWER_ENDING, null);
  }
  const payload = await readJson(response);
  if (response.ok) return { ok: true, payload };
  const { status } = response;
  // A sign-in that ended is never worded by the server: what was typed is at risk.
  const reason = status === 401 ? SIGNED_OUT_ENDING : (serverSentence(payload) ?? endingForStatus(status));
  return failure(request, reason, status);
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
 * Which message the page shows next. `incoming` is null when an action starts
 * and clears the old message.
 *
 * Two actions can overlap, so a save that works can end after a Verify that
 * failed. An error that is showing therefore stays: no success replaces it
 * and no starting action clears it. Only a newer error does. Dismiss and a
 * tab change do not come through here; they set the message to null.
 */
export function nextNotice(showing: Notice | null, incoming: Notice | null): Notice | null {
  if (showing?.kind === "error" && incoming?.kind !== "error") return showing;
  return incoming;
}

/**
 * The value of a single-id in-flight flag after the request for `mine` has
 * ended. If a later request holds the flag, it keeps it, so its button stays
 * off until its own answer comes back.
 */
export function releaseFlag(holder: string | null, mine: string): string | null {
  return holder === mine ? null : holder;
}

/** The first sentence of a message, shown in bold, and whatever follows it. */
export interface SplitMessage {
  lead: string;
  rest: string;
}

/** The end of a sentence: a full stop, question mark or exclamation mark, then a space. */
const SENTENCE_END = /[.!?]\s+/u;

/**
 * Splits a message after its first sentence. A failure is worded as what did
 * not happen, then why, so the lead is the part to read first.
 */
export function leadSentence(text: string): SplitMessage {
  const trimmed = text.trim();
  const end = trimmed.match(SENTENCE_END);
  if (!end || end.index === undefined) return { lead: trimmed, rest: "" };
  const cut = end.index + 1;
  return { lead: trimmed.slice(0, cut), rest: trimmed.slice(cut).trim() };
}

/**
 * What the page does after an orientation step is confirmed or sent back.
 * `finish` is the answer to the call that marks orientation finished, sent
 * after a confirm that worked, or null when it was not sent.
 *
 * While required steps remain, the server refuses that call, and that is not
 * shown. Any other failure is: the step is saved but the student's
 * orientation is not marked finished. The page is not reloaded then, because
 * a reload removes the Confirm button, the only way to send the call again.
 */
export function orientationOutcome(
  step: StudentActionResult,
  finish: StudentActionResult | null,
  done: string,
): ActionOutcome {
  const outcome = actionOutcome(step, done);
  if (finish === null || finish.ok || finish.status === STEPS_REMAIN_STATUS) return outcome;
  return { notice: { kind: "error", text: ORIENTATION_NOT_FINISHED }, resetForm: false, reload: false };
}

/**
 * Sends one write for the page. A failure is shown and the page is left as it
 * is, because nothing changed. A success reloads the student, then shows the
 * done line. The page's `notify` decides what is shown: see `nextNotice`.
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
