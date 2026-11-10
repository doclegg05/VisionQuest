import { PASSWORD_TOO_LONG_MESSAGE, STUDENT_PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/password-policy";

/**
 * Where a refused password change shows and what it says, as a pure function
 * of the response. The change form shows only sentences it knows: the
 * server's words reach the student only under a status and code this table
 * expects. Anything else, such as a raw "Unauthorized" or "Forbidden: origin
 * mismatch.", becomes the form's own fallback.
 *
 * This module imports only the password policy, which imports nothing, so it
 * is safe in the browser. The server's sentences live in
 * src/lib/password-change.ts and are built from the sign-in budget there.
 */

export const FALLBACK_REFUSAL = "We could not change your password. Please try again.";
export const NETWORK_REFUSAL = "We could not reach the server. Please try again.";
/** The same words the change route's schema answers an empty current password with. */
export const MISSING_CURRENT_PASSWORD = "Type the password you use now.";
export const SIGNED_OUT_SETTINGS = "You were signed out. Sign in again.";
export const SIGNED_OUT_FORCED = "You were signed out. Sign in again with the password your instructor gave you.";

/** Under the current field, under the new field, or above the button. */
export type RefusalPlace = "current" | "new" | "form";

export interface RefusalView {
  place: RefusalPlace;
  message: string;
  /** Whether to offer a way to the sign-in page: the session is over. */
  signIn: boolean;
}

interface KnownRefusal {
  status: number;
  place: RefusalPlace;
  signIn: boolean;
}

/** Every refusal code src/lib/password-change.ts sends, with the status it sends it under. */
const KNOWN_CODES: Readonly<Record<string, KnownRefusal>> = {
  WRONG_CURRENT_PASSWORD: { status: 400, place: "current", signIn: false },
  SAME_AS_CURRENT_PASSWORD: { status: 400, place: "new", signIn: false },
  PASSWORD_CONTAINS_LOGIN: { status: 400, place: "new", signIn: false },
  NO_PASSWORD_SET: { status: 400, place: "form", signIn: false },
  TOO_MANY_WRONG_TRIES: { status: 429, place: "form", signIn: false },
  PASSWORD_CHANGE_UNAVAILABLE: { status: 503, place: "form", signIn: false },
  PASSWORD_CHANGED_ELSEWHERE: { status: 409, place: "form", signIn: true },
};

/** The schema's answers the form knows word for word, and the field each is about. */
const KNOWN_SCHEMA_SENTENCES: ReadonlyMap<string, RefusalPlace> = new Map([
  [STUDENT_PASSWORD_TOO_SHORT_MESSAGE, "new"],
  [PASSWORD_TOO_LONG_MESSAGE, "new"],
  [MISSING_CURRENT_PASSWORD, "current"],
]);

const FALLBACK_VIEW: RefusalView = { place: "form", message: FALLBACK_REFUSAL, signIn: false };

/** The body's `code` and `error` when they are non-empty strings. */
function readBody(body: unknown): { code: string | null; error: string | null } {
  if (typeof body !== "object" || body === null) return { code: null, error: null };
  const code = "code" in body && typeof body.code === "string" ? body.code : null;
  const error = "error" in body && typeof body.error === "string" && body.error !== "" ? body.error : null;
  return { code, error };
}

/**
 * What the form shows for a refused change. `signedOutMessage` is the
 * surface's own words for a session that ended.
 */
export function refusalView(status: number, body: unknown, signedOutMessage: string): RefusalView {
  if (status === 401) return { place: "form", message: signedOutMessage, signIn: true };
  const { code, error } = readBody(body);
  if (error === null) return FALLBACK_VIEW;

  const known = code === null ? undefined : KNOWN_CODES[code];
  if (known && known.status === status) return { place: known.place, message: error, signIn: known.signIn };

  const schemaPlace = status === 400 ? KNOWN_SCHEMA_SENTENCES.get(error) : undefined;
  if (schemaPlace) return { place: schemaPlace, message: error, signIn: false };
  return FALLBACK_VIEW;
}

/** What the form shows when the request never got an answer. */
export const NETWORK_VIEW: RefusalView = { place: "form", message: NETWORK_REFUSAL, signIn: false };
