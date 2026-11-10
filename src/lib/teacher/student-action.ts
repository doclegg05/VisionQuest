/**
 * One way to send a write from the instructor's student page.
 *
 * The page used to send its requests and never read the answer. A Verify that
 * failed reloaded the page unchanged, so the instructor could not tell it from
 * one that worked, and grant reports count only verified outcomes. Every write
 * on that page goes through here, so a failure always comes back as a message
 * to show. `StudentDetail.action-errors.test.tsx` fails if one does not.
 */

import { apiFetch } from "@/lib/api";

export interface StudentActionRequest {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  /** Sent as JSON. Leave out for a request with no body. */
  body?: unknown;
  /**
   * Shown when the server gives no message a person can use. Say what did not
   * happen and what to do next.
   */
  fallback: string;
}

export type StudentActionResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string };

/** The two things an action needs from the page it runs on. */
export interface StudentActionPage {
  /** Puts a message in the page banner. `null` clears it. */
  report: (message: string | null) => void;
  /** Loads the student again after a change. */
  reload: () => Promise<void>;
}

/**
 * The code `withErrorHandler` puts on an error it did not expect. Its message
 * ("Internal server error") tells an instructor nothing, so the caller's own
 * sentence is shown in its place.
 */
const UNHANDLED_ERROR_CODE = "INTERNAL_ERROR";

/** The server's own words for what went wrong, when it sent any worth showing. */
function serverMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if ("code" in payload && payload.code === UNHANDLED_ERROR_CODE) return null;
  if (!("error" in payload) || typeof payload.error !== "string") return null;
  return payload.error.trim() || null;
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
 * Sends one write and reports how it went. Never throws: a dropped connection
 * and an answer that is not ok both come back as `{ ok: false, message }`.
 * A 401 also sends the browser to sign-in, as `apiFetch` does everywhere.
 */
export async function sendStudentAction(request: StudentActionRequest): Promise<StudentActionResult> {
  const hasBody = request.body !== undefined;
  try {
    const response = await apiFetch(request.url, {
      method: request.method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
    const payload = await readJson(response);
    if (response.ok) return { ok: true, payload };
    return { ok: false, message: serverMessage(payload) ?? request.fallback };
  } catch (error: unknown) {
    // No answer arrived. Only the error's name is logged: no URL and no body,
    // because both can carry a student's id.
    console.error("Student action got no answer:", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: request.fallback };
  }
}

/**
 * Sends one write for the page. A failure goes to the banner and the page is
 * left as it is, because nothing changed. A success reloads the student.
 */
export async function runStudentAction(
  request: StudentActionRequest,
  page: StudentActionPage,
): Promise<StudentActionResult> {
  page.report(null);
  const result = await sendStudentAction(request);
  if (result.ok) {
    await page.reload();
  } else {
    page.report(result.message);
  }
  return result;
}
