// =============================================================================
// Shared plumbing for the four `/api/connect/employer/[token]/…` handlers.
//
// Each one has to do the same five things before it touches anything: read the
// token from the BODY (not only the path), resolve it through the bounded
// helper, rate-limit per token, and refuse everything else with one neutral
// message. Doing that once here means a fifth action added later cannot
// forget a step.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPlainConfigValue } from "@/lib/system-config";
import { rateLimit } from "@/lib/rate-limit";

import { CONNECT_CONFIG_KEY } from "./flags-shared";
import {
  EMPLOYER_LINK_INACTIVE_MESSAGE,
  hashEmployerToken,
  normalizeEmployerToken,
  resolveEmployerLink,
  type EmployerLinkView,
} from "./employer-link";

/** 10 actions per token per hour (Task 4.4). */
export const EMPLOYER_ACTION_LIMIT = 10;
export const EMPLOYER_ACTION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Every employer POST carries the token in its body as well as its path.
 *
 * Not redundancy for its own sake: the middleware's origin check is what
 * protects these routes from a cross-site POST, and requiring the token in the
 * body means a form on another site cannot drive an action using only a URL
 * somebody pasted into a chat.
 */
export const employerTokenBodySchema = z.object({
  token: z.string().min(20).max(200),
});

export type EmployerRequestResult =
  | { ok: true; view: EmployerLinkView }
  | { ok: false; response: NextResponse };

function inactive(status = 404): NextResponse {
  return NextResponse.json({ error: EMPLOYER_LINK_INACTIVE_MESSAGE }, { status });
}

/**
 * Resolve and rate-limit an employer action.
 *
 * The limiter is keyed on the token HASH, never the token: rate-limit keys are
 * written to a table staff can read, and a capability URL in that table would
 * be a capability URL anyone with database access could use.
 *
 * The path token and the body token must match. A mismatch is treated exactly
 * like an unknown token.
 */
export async function resolveEmployerRequest(
  pathToken: string,
  bodyToken: string,
  clientIp: string | null,
): Promise<EmployerRequestResult> {
  const fromPath = normalizeEmployerToken(pathToken);
  const fromBody = normalizeEmployerToken(bodyToken);
  if (!fromPath || !fromBody || fromPath !== fromBody) {
    return { ok: false, response: inactive() };
  }

  // RESOLVE FIRST, then rate-limit.
  //
  // The first cut limited on the candidate token's hash before resolving, so
  // every guess wrote a new `RateLimitEntry` row keyed on an attacker-chosen
  // value — an unbounded insert primitive on a shared table, reachable with no
  // account. Unknown tokens now cost only a coarse per-IP bucket, and only a
  // token that resolves gets a per-token counter.
  const view = await resolveEmployerLink(
    fromPath,
    await getPlainConfigValue(CONNECT_CONFIG_KEY),
  );

  if (!view) {
    const guesses = await rateLimit(
      `connect-employer-unknown:${clientIp ?? "unknown"}`,
      UNKNOWN_TOKEN_LIMIT,
      EMPLOYER_ACTION_WINDOW_MS,
    );
    // Fail closed, consistently with the send limiter: a limiter that cannot
    // count must not become an open door.
    if (!guesses.success || guesses.degraded) {
      return { ok: false, response: tooMany() };
    }
    return { ok: false, response: inactive() };
  }

  const tokenHash = hashEmployerToken(fromPath);
  const limit = await rateLimit(
    `connect-employer:${tokenHash.slice(0, 32)}`,
    EMPLOYER_ACTION_LIMIT,
    EMPLOYER_ACTION_WINDOW_MS,
  );
  if (!limit.success || limit.degraded) {
    return { ok: false, response: tooMany() };
  }

  return { ok: true, view };
}

function tooMany(): NextResponse {
  return NextResponse.json(
    { error: "Too many tries. Please wait a little and try again." },
    { status: 429 },
  );
}

/** Coarse bucket for tokens that resolve to nothing. Per IP, not per guess. */
export const UNKNOWN_TOKEN_LIMIT = 20;

/**
 * The client's IP, for the unknown-token bucket only.
 *
 * Behind Render's proxy the socket address is the proxy's, so the forwarded
 * header is the only signal available. It is spoofable, which is why it gates
 * nothing but this coarse bucket — never authorization.
 */
export function clientIpFrom(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}
