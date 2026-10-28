import { z } from "@/lib/zod-csp";

import { DEMO_ACCOUNT_KINDS, type DemoAccountKind } from "@/lib/demo/config";
import { DEMO_CONTINUE_AS_PREFIX, DEMO_ENTRY_FAILED, DEMO_ENTRY_OFFLINE, DEMO_ENTRY_PENDING } from "@/lib/demo/copy";

/**
 * The decisions behind the demo buttons on the sign-in page, kept apart from
 * React so they can be tested on their own. DemoEntryButtons does the fetching
 * and the rendering; this file decides what a response means.
 *
 * The two parsers take `unknown`: they read the body of a response from our own
 * server, but a network proxy, an error page or a stale deploy can put
 * anything there, so each body is parsed before it is trusted.
 */

/**
 * Where each kind of demo account lands, matching the redirects the entry
 * endpoints send. `satisfies` makes a new kind of account a compile error here,
 * and this one record feeds both the Continue as links and the redirects the
 * entry buttons will follow.
 */
const HOME_BY_KIND = {
  student: "/dashboard",
  instructor: "/teacher",
} as const satisfies Record<DemoAccountKind, string>;

/**
 * The part of GET /api/auth/session this page reads. `demoAccount` is absent
 * for a real account, so a missing or null value is allowed here and then
 * refused in `continueTargetFor`.
 */
const SessionBodySchema = z.object({
  student: z.object({
    displayName: z.string().trim().min(1),
    demoAccount: z.enum(DEMO_ACCOUNT_KINDS).nullish(),
  }),
});

export interface ContinueTarget {
  label: string;
  href: string;
}

/**
 * The "Continue as ..." link for a visitor who already has a live demo session.
 * Null for everyone else: a real student or teacher, a visitor with no session
 * (the 401 body), or a body that is not a session at all.
 */
export function continueTargetFor(body: unknown): ContinueTarget | null {
  const parsed = SessionBodySchema.safeParse(body);
  if (!parsed.success) return null;

  const { displayName, demoAccount } = parsed.data.student;
  if (!demoAccount) return null;

  return { label: `${DEMO_CONTINUE_AS_PREFIX} ${displayName}`, href: HOME_BY_KIND[demoAccount] };
}

/**
 * The pages the entry endpoints send a visitor to, and no others.
 *
 * The destinations are known, so this is a list and not a pattern. A pattern
 * that tries to recognize "a page on this site" has to guess how a browser will
 * read the string, and the URL parser deletes tab, line feed and carriage return
 * before it reads the path: "/\t/evil.example" looks like a path and resolves to
 * https://evil.example/. An exact match has nothing to guess.
 */
const LandingPageSchema = z.enum(Object.values(HOME_BY_KIND));

const EntrySuccessSchema = z.object({ redirectTo: LandingPageSchema });
const EntryRefusalSchema = z.object({ error: z.string().trim().min(1) });

export type DemoEntryOutcome =
  | { kind: "enter"; redirectTo: string }
  | { kind: "refused"; message: string };

/**
 * What to do with the answer from POST /api/demo/student or /api/demo/instructor.
 * On success, go where the endpoint says. Otherwise show the endpoint's own
 * message (the limit messages are written for the visitor), or a short retry
 * message when the body carries none, or when a success body names no safe page.
 */
export function entryOutcomeFor(ok: boolean, body: unknown): DemoEntryOutcome {
  if (ok) {
    const success = EntrySuccessSchema.safeParse(body);
    if (success.success) return { kind: "enter", redirectTo: success.data.redirectTo };
    return { kind: "refused", message: DEMO_ENTRY_FAILED };
  }

  const refusal = EntryRefusalSchema.safeParse(body);
  return { kind: "refused", message: refusal.success ? refusal.data.error : DEMO_ENTRY_FAILED };
}

/** The answer when the request itself failed: no reply at all, so the visitor's connection is the likely cause. */
export function offlineOutcome(): DemoEntryOutcome {
  return { kind: "refused", message: DEMO_ENTRY_OFFLINE };
}

export interface EntryButtonView {
  label: string;
  disabled: boolean;
}

/**
 * How one entry button looks while at most one request is running. The pressed
 * button says the demo is starting and the other keeps its own label, and both
 * are disabled so a second request cannot start.
 */
export function entryButtonViewFor(
  pressedEndpoint: string | null,
  endpoint: string,
  idleLabel: string,
): EntryButtonView {
  if (pressedEndpoint === null) return { label: idleLabel, disabled: false };
  return { label: pressedEndpoint === endpoint ? DEMO_ENTRY_PENDING : idleLabel, disabled: true };
}

/** What the status region says while a request runs: the words on the pressed button, or nothing. */
export function announcementFor(pressedEndpoint: string | null): string {
  return pressedEndpoint === null ? "" : DEMO_ENTRY_PENDING;
}
