import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_PATTERN, REDACTED_EMAIL, providerErrorText, redactContactInfo } from "./log-redaction";

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

/**
 * EMAIL_PATTERN as it stood before the run-start lookbehind (F18). It is the
 * reference: the fix must not change what is matched, because a match the
 * pattern loses is an address that reaches the logs or the cloud model.
 */
const PRE_FIX_EMAIL_PATTERN =
  /[^\s<>()[\]:;,"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

function emailMatches(pattern: RegExp, text: string): Array<[number | undefined, string]> {
  const fresh = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(fresh)].map((m) => [m.index, m[0]]);
}

function assertSameAsPreFix(text: string): void {
  const label = JSON.stringify(text);
  assert.deepEqual(emailMatches(EMAIL_PATTERN, text), emailMatches(PRE_FIX_EMAIL_PATTERN, text), label);
  assert.equal(
    text.replace(new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags), REDACTED_EMAIL),
    text.replace(new RegExp(PRE_FIX_EMAIL_PATTERN.source, "g"), REDACTED_EMAIL),
    label,
  );
}

/** Best of a few runs, so one GC pause on a busy runner cannot fail the bound. */
function bestOfMs(runs: number, fn: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("EMAIL_PATTERN backtracking (F18)", () => {
  it("matches exactly what the pre-fix pattern matched", () => {
    const corpus = [
      "jane.doe@example.com",
      "550 5.1.1 <jane.doe@example.com>: recipient rejected",
      "first.last+tag@sub.domain.co.uk wrote",
      "foo_bar@baz.com and foo-bar@baz.com",
      "a@b@c.com",
      "a@b.c@d.e",
      "@a@b.co",
      "@leading.com @@x.io",
      "@a".repeat(50),
      "a@".repeat(50) + "b.co",
      "a@b-.com a@-b.com a@b.c- a@b.co-uk",
      "a@b.co_x@y.co",
      "a@b.co_x",
      "a@b.co_x@y",
      "(a@b.co) [a@b.co] <a@b.co> a@b.co;c@d.co a@b.co,c@d.co \"a@b.co\" :a@b.co:",
      "a@b.co\tc@d.co\ne@f.gh i@j.kl m@n.op",
      "mailto:jane@example.com https://user:pw@host.example.com/path",
      "josé@example.com üser@exämple.com 名前@例え.jp 😀x@y.co \ud83dx@y.co",
      "[EMAIL_1]@x.com x@[EMAIL_1].com [STUDENT_EMAIL]x@y.co",
      "a".repeat(200) + "@example.com",
      "user@localhost user@1.2.3.4 -@-.- ...@...",
      "no address here at all",
      "a".repeat(300),
      "a.".repeat(150),
    ];
    for (const text of corpus) assertSameAsPreFix(text);
    // The corpus must exercise real matches, not only misses.
    assert.ok(corpus.filter((text) => emailMatches(PRE_FIX_EMAIL_PATTERN, text).length > 0).length >= 15);
  });

  it("matches exactly what the pre-fix pattern matched on generated boundary strings", () => {
    const alphabet = [
      "a", "Z", "0", "-", ".", ".", "_", "+", "@", "@", "<", ">", "(", ")", "[", "]",
      ":", ";", ",", '"', " ", "\n", " ", "é", "😀", "\ud83d", "[EMAIL_1]", "x@y.co",
    ];
    // mulberry32: a fixed seed keeps the corpus reproducible.
    let seed = 20261022;
    const next = (n: number): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let z = Math.imul(seed ^ (seed >>> 15), seed | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) % n;
    };
    let withMatch = 0;
    for (let i = 0; i < 5_000; i += 1) {
      let text = "";
      const length = 1 + next(24);
      for (let j = 0; j < length; j += 1) text += alphabet[next(alphabet.length)];
      assertSameAsPreFix(text);
      if (emailMatches(PRE_FIX_EMAIL_PATTERN, text).length > 0) withMatch += 1;
    }
    // A generator that never produces an address would prove nothing.
    assert.ok(withMatch >= 1_000, `only ${withMatch} generated strings held an address`);
  });

  it("redacts 10,000-character runs with no whitespace in linear time", (t) => {
    const inputs = ["a".repeat(10_000), "@a".repeat(5_000)];
    redactContactInfo(inputs[0]); // compile the regexes once
    const elapsed = bestOfMs(3, () => {
      for (const text of inputs) redactContactInfo(text);
    });
    t.diagnostic(`redactContactInfo over two 10,000-char runs: ${elapsed.toFixed(2)} ms`);
    // Pre-fix: about 150 ms on an Apple M4 (each start index re-scanned the
    // rest of the run). Post-fix: well under 1 ms. The bound leaves room for
    // a slow CI runner without letting a quadratic pattern back in.
    assert.ok(elapsed < 25, `redactContactInfo took ${elapsed.toFixed(1)} ms`);
  });
});

describe("providerErrorText", () => {
  it("keeps an SMTP rejection's reason and masks the address it quotes", () => {
    const error = new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <jane.doe@example.com>: Recipient address rejected");
    const out = providerErrorText(error);
    assert.ok(!out.includes("jane.doe@example.com"));
    assert.ok(out.includes("550 5.1.1"), "keeps the SMTP status code");
    assert.ok(out.includes("Recipient address rejected"), "keeps the provider's reason");
  });

  it("uses the message, not the Error's string form with its class name", () => {
    assert.equal(providerErrorText(new Error("Email delivery is not configured.")), "Email delivery is not configured.");
  });

  it("redacts a thrown non-Error value too", () => {
    assert.equal(providerErrorText("rejected +15551234567"), "rejected [phone redacted]");
  });
});
