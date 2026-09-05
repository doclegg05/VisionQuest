import { NextResponse } from "next/server";

import { isSignedWebhookPath } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { adminClientIsPrivileged } from "@/lib/nudges/admin-guard";
import { handleInboundSms } from "@/lib/nudges/replies";
import { verifyTwilioSignature } from "@/lib/nudges/twilio-signature";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/sms/inbound — Twilio's inbound-message webhook.
 *
 * This is the one POST in the application made by a third party, so it carries
 * no session, no CSRF token, and no Origin header of ours. It is exempt from
 * the Origin check in src/proxy.ts (SIGNED_WEBHOOK_PATHS in src/lib/csrf.ts)
 * and pays for that exemption here: nothing happens until Twilio's
 * `X-Twilio-Signature` verifies against TWILIO_AUTH_TOKEN over the exact URL
 * and form fields of THIS request. With no token configured, verification
 * fails and the route is inert — which is the right default for an
 * installation that has not turned SMS on.
 *
 * The reply is always empty TwiML. Twilio renders whatever comes back to the
 * sender, so an error message here would text a student a stack trace; the
 * outcome of the request belongs in our logs, not in their inbox.
 *
 * Twilio's signature carries no nonce and no timestamp, so a captured request
 * verifies forever. Every handler this route reaches must therefore be
 * idempotent, and they are: STOP and START are settings writes, and a reply
 * claims its question with a conditional UPDATE that a replay loses.
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** A real Twilio webhook is a few hundred bytes; 16 KB is generous. */
const MAX_BODY_BYTES = 16 * 1024;

/** Per-number, so one handset cannot be used to hammer the reply handler. */
const INBOUND_LIMIT = 10;
const INBOUND_WINDOW_MS = 60 * 60 * 1000;

function twiml(): NextResponse {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/**
 * The absolute URL Twilio signed.
 *
 * Twilio signs the URL it was configured with, which on Render is the public
 * https origin — but the app sees a proxied request whose `req.url` can be
 * http and can carry the internal host. APP_BASE_URL is the configured public
 * origin, so it is preferred; the request URL is the fallback for a local run
 * where the two are the same.
 *
 * LIMITATION: this rebuilds the URL from APP_BASE_URL's ORIGIN plus the
 * request's path, so an APP_BASE_URL carrying a base path
 * ("https://host/spokes") would drop that path and the signature would never
 * verify. VisionQuest is deployed at a bare origin, so this is not a live
 * problem — but if the app is ever mounted under a sub-path, join the base
 * path back on here first.
 */
export function signedRequestUrl(req: Request): string {
  const requestUrl = new URL(req.url);
  const configured = process.env.APP_BASE_URL;
  if (!configured) return requestUrl.toString();
  try {
    // `origin` rather than assigning protocol and host separately: the URL
    // host setter keeps an existing port unless the new value carries one, so
    // a proxied :10000 would survive into the string being signed.
    return new URL(`${requestUrl.pathname}${requestUrl.search}`, new URL(configured).origin)
      .toString();
  } catch {
    return requestUrl.toString();
  }
}

/** One-way key for the rate limiter, so no phone number reaches the store. */
async function phoneKey(from: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(from).digest("hex").slice(0, 16);
}

export async function POST(req: Request): Promise<NextResponse> {
  // Belt and braces: if this path is ever removed from the exemption list, the
  // route should stop pretending it is reachable without an Origin.
  if (!isSignedWebhookPath(new URL(req.url).pathname)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Bound the body BEFORE parsing it. This is an unauthenticated endpoint
  // until the signature check below, so `formData()` on an unbounded stream is
  // a free way for anyone who knows the URL to make the server buffer whatever
  // they send. A real Twilio webhook is well under a kilobyte.
  const declaredLength = Number(req.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const verified = verifyTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    url: signedRequestUrl(req),
    params,
    signature: req.headers.get("x-twilio-signature"),
  });
  if (!verified) {
    // No detail in the body and none in the log beyond the fact of it: a
    // forger learns nothing about which half of the check failed.
    logger.warn("Rejected an inbound SMS with an invalid signature", { channel: "sms" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";
  if (!from) return twiml();

  const limit = await rateLimit(`sms-inbound:${await phoneKey(from)}`, INBOUND_LIMIT, INBOUND_WINDOW_MS);
  if (!limit.success) {
    // Still 200 with empty TwiML: Twilio retries a non-2xx, and a retry storm
    // on a limiter is worse than dropping one message.
    logger.warn("Inbound SMS rate limit reached", { channel: "sms" });
    return twiml();
  }

  // F63 again: with an unprivileged admin client the phone lookup returns
  // nothing and a STOP would be silently dropped, which is the one failure in
  // this route that must never be quiet. 200 with empty TwiML so Twilio does
  // not retry into the same broken state; the error is in the log.
  if (!(await adminClientIsPrivileged())) {
    logger.error("nudges_admin_client_missing", { surface: "sms_inbound" });
    return twiml();
  }

  try {
    const result = await handleInboundSms({ from, body });
    logger.info("Inbound SMS handled", { channel: "sms", outcome: result.outcome });
  } catch (error) {
    // Never surface a failure to the sender, and never a non-2xx: Twilio would
    // retry, and a retried STOP that half-applied is worse than a logged one.
    logger.error("Inbound SMS handling failed", { channel: "sms", error: String(error) });
  }

  return twiml();
}
