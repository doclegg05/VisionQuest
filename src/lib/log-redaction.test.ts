import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactContactInfo } from "./log-redaction";

describe("redactContactInfo", () => {
  it("masks an email address quoted by an SMTP rejection", () => {
    const out = redactContactInfo("550 5.1.1 <jane.doe@example.com>: recipient rejected");
    assert.ok(!out.includes("jane.doe@example.com"));
    assert.ok(out.includes("550 5.1.1"), "keeps the SMTP status code");
  });

  it("masks an E.164 phone number quoted by a Twilio error", () => {
    const out = redactContactInfo("The 'To' number +15551234567 is not a valid phone number");
    assert.ok(!out.includes("+15551234567"));
    assert.ok(out.includes("not a valid phone number"), "keeps the provider's reason");
  });

  it("masks separator-formatted phone numbers", () => {
    for (const raw of ["555-123-4567", "(555) 123-4567", "555.123.4567"]) {
      const out = redactContactInfo(`failed for ${raw} today`);
      assert.ok(!out.includes(raw), `did not mask ${raw}`);
    }
  });

  it("masks every occurrence, not just the first", () => {
    const out = redactContactInfo("a@x.com relayed to b@y.com");
    assert.ok(!out.includes("a@x.com"));
    assert.ok(!out.includes("b@y.com"));
  });

  it("leaves bare digit runs alone so timestamps and ids survive", () => {
    const out = redactContactInfo("failed at 1755691234567 with code 21211 after 4096 bytes");
    assert.equal(out, "failed at 1755691234567 with code 21211 after 4096 bytes");
  });

  it("returns non-string input as an empty string rather than throwing", () => {
    assert.equal(redactContactInfo(undefined as unknown as string), "");
  });
});
