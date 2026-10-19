import { z } from "zod";

import { DEMO_ACCOUNT_KINDS, type DemoAccountKind } from "@/lib/demo/config";
import { DEMO_CONTINUE_AS_PREFIX, DEMO_ENTRY_FAILED } from "@/lib/demo/copy";

/**
 * The decisions behind the demo buttons on the sign-in page, kept apart from
 * React so they can be tested on their own. DemoEntryButtons does the fetching
 * and the rendering; this file decides what a response means.
 *
 * Both functions take `unknown`: they read the body of a response from our own
 * server, but a network proxy, an error page or a stale deploy can put
 * anything there, so each body is parsed before it is trusted.
 */

/** Where each kind of demo account lands, matching the redirects the entry endpoints send. */
const HOME_BY_KIND: Record<DemoAccountKind, string> = {
  student: "/dashboard",
  instructor: "/teacher",
};

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
 * A page on this site. A single leading slash only: `//host` and `/\host` are
 * read by browsers as another origin, so neither may reach router.push.
 */
const SameSitePathSchema = z.string().regex(/^\/(?![/\\])/);

const EntrySuccessSchema = z.object({ redirectTo: SameSitePathSchema });
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
