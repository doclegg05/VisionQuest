import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERIC_AUTH_ERROR_MESSAGE, lookupErrorMessage } from "./error-message-lookup";

const MESSAGES: Record<string, string> = {
  oauth_email_unverified: "Google has not confirmed this email address yet.",
};

describe("lookupErrorMessage", () => {
  it("returns the copy for a known code", () => {
    assert.equal(lookupErrorMessage(MESSAGES, "oauth_email_unverified"), MESSAGES.oauth_email_unverified);
  });

  it("returns null when the URL carries no code", () => {
    assert.equal(lookupErrorMessage(MESSAGES, null), null);
    assert.equal(lookupErrorMessage(MESSAGES, ""), null);
  });

  it("falls back to the generic copy for an unknown code", () => {
    assert.equal(lookupErrorMessage(MESSAGES, "not_a_code"), GENERIC_AUTH_ERROR_MESSAGE);
  });

  it("fails closed on prototype keys a crafted link can put in the URL", () => {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const message = lookupErrorMessage(MESSAGES, key);
      assert.equal(typeof message, "string", `${key} must resolve to a string, never an object or function`);
      assert.equal(message, GENERIC_AUTH_ERROR_MESSAGE, `${key} must use the generic copy`);
    }
  });
});
