// =============================================================================
// Twilio request signature validation.
//
// The inbound SMS webhook is the one POST in this application that a third
// party makes, so it cannot carry our Origin header and is exempt from the
// CSRF check in src/proxy.ts (see SIGNED_WEBHOOK_PATHS in src/lib/csrf.ts).
// That exemption is only safe because every request is authenticated HERE
// instead, by the signature Twilio computes with the account's auth token.
//
// The algorithm (Twilio, "Validating requests"): take the full request URL
// including its query string, append each POST parameter's name and value in
// name order with no separators, HMAC-SHA1 the result with the auth token, and
// base64 the digest. Twilio sends that in `X-Twilio-Signature`.
//
// Implemented here rather than pulled from the `twilio` SDK because the SDK is
// not a dependency of this repo and this is twenty lines; the published worked
// example is pinned as a test vector, which is the only thing that proves the
// concatenation order is right.
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

export function buildTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let payload = url;
  for (const key of Object.keys(params).sort()) {
    payload += key + params[key];
  }
  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

/**
 * Never throws, and fails closed on every unknown: an unset auth token, a
 * missing header, a malformed base64 string. The comparison is length-checked
 * first and then constant-time, so a mismatch leaks no information about how
 * much of the signature was right.
 */
export function verifyTwilioSignature(input: {
  authToken: string | undefined;
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
}): boolean {
  const { authToken, url, params, signature } = input;
  if (!authToken || !signature) return false;

  let expected: Buffer;
  let received: Buffer;
  try {
    expected = Buffer.from(buildTwilioSignature(authToken, url, params), "base64");
    received = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0 || expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
