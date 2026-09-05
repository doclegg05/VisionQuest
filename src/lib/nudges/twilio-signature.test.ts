import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTwilioSignature, verifyTwilioSignature } from "./twilio-signature";

/**
 * Twilio's own published worked example (Security → validating requests). It
 * is the only way to prove the concatenation order and the base64 encoding are
 * right: a home-grown HMAC that is self-consistent will verify its own output
 * happily while rejecting every real Twilio request.
 */
const VECTOR = {
  authToken: "12345",
  url: "https://mycompany.com/myapp.php?foo=1&bar=2",
  params: {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675309",
    Digits: "1234",
    From: "+14158675309",
    To: "+18005551212",
  },
  signature: "RSOYDt4T1cUTdK1PDd93/VVr8B8=",
};

describe("buildTwilioSignature", () => {
  it("reproduces Twilio's published signature for its published example", () => {
    assert.equal(
      buildTwilioSignature(VECTOR.authToken, VECTOR.url, VECTOR.params),
      VECTOR.signature,
    );
  });

  it("sorts parameters by name, so submission order cannot change the result", () => {
    const reordered = {
      To: VECTOR.params.To,
      Digits: VECTOR.params.Digits,
      CallSid: VECTOR.params.CallSid,
      From: VECTOR.params.From,
      Caller: VECTOR.params.Caller,
    };
    assert.equal(buildTwilioSignature(VECTOR.authToken, VECTOR.url, reordered), VECTOR.signature);
  });

  it("signs the full URL including its query string", () => {
    const withoutQuery = buildTwilioSignature(
      VECTOR.authToken,
      "https://mycompany.com/myapp.php",
      VECTOR.params,
    );
    assert.notEqual(withoutQuery, VECTOR.signature);
  });
});

describe("verifyTwilioSignature", () => {
  it("accepts the real signature", () => {
    assert.equal(
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: VECTOR.url,
        params: VECTOR.params,
        signature: VECTOR.signature,
      }),
      true,
    );
  });

  it("rejects a tampered body, a tampered URL, and the wrong token", () => {
    const tamperedBody = { ...VECTOR.params, Digits: "9999" };
    assert.equal(
      verifyTwilioSignature({ ...VECTOR, params: tamperedBody }),
      false,
      "a changed parameter must invalidate the signature",
    );
    assert.equal(
      verifyTwilioSignature({ ...VECTOR, url: "https://evil.example/myapp.php?foo=1&bar=2" }),
      false,
    );
    assert.equal(verifyTwilioSignature({ ...VECTOR, authToken: "54321" }), false);
  });

  it("rejects a missing, empty, or wrong-length signature without throwing", () => {
    for (const signature of ["", "not-base64", "AAAA"]) {
      assert.equal(verifyTwilioSignature({ ...VECTOR, signature }), false, signature);
    }
  });

  it("fails closed when no auth token is configured", () => {
    assert.equal(verifyTwilioSignature({ ...VECTOR, authToken: "" }), false);
    assert.equal(verifyTwilioSignature({ ...VECTOR, authToken: undefined }), false);
  });
});
