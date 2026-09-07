import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TokenVault } from "./deidentify";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

/**
 * Wave 2 additions to the 1C vault, both from the 1C builder's own report:
 *
 *  1. `[STUDENT_FIRST_NAME]` — a first-name-only mention re-hydrates to the
 *     FIRST name. Without it, Sage's scripted "Hey [name], good to see you."
 *     (system-prompts.ts check-in stage) comes back as "Hey Jordan Lee".
 *  2. `DeidentifyOptions.allowlist` — values that must never be tokenized:
 *     the 988 crisis line and the program office's own contact details, which
 *     the SYSTEM prompt carries and which a student must still be able to read
 *     in Sage's reply. An allowlisted value is protected wherever it appears;
 *     a different value of the same shape (the student's own phone) is not.
 *
 * The 1C file (deidentify.test.ts) keeps every other guarantee; the three
 * fixtures there that pinned "a first-name mention re-hydrates to the full
 * name" are updated in the same commit, not deleted.
 */

const TOKEN_GRAMMAR = /^\[[A-Z]+(?:_[A-Z]+)*(?:_\d+)?\]$/;

describe("[STUDENT_FIRST_NAME] (Wave 2 addendum)", () => {
  it("maps a first-name-only mention to [STUDENT_FIRST_NAME] and the full name to [STUDENT_NAME]", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.pseudonymize("Jordan Lee signed in"), "[STUDENT_NAME] signed in");
    assert.equal(vault.pseudonymize("hey jordan"), "hey [STUDENT_FIRST_NAME]");
    assert.equal(vault.pseudonymize("JORDAN!"), "[STUDENT_FIRST_NAME]!");
  });

  it("re-hydrates [STUDENT_FIRST_NAME] to the first name only — the reason the token exists", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    // The check-in stage scripts `Hey [name], good to see you.`; before this
    // token the model's echo re-hydrated to "Hey Jordan Lee, good to see you."
    const out = vault.pseudonymize("Hey Jordan, good to see you.");
    assert.equal(out, "Hey [STUDENT_FIRST_NAME], good to see you.");
    assert.equal(vault.rehydrate(out), "Hey Jordan, good to see you.");
  });

  it("keeps a non-first name part on [STUDENT_NAME] (loud over-restoration, never a wrong name)", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.rehydrate(vault.pseudonymize("Lee is here")), "Jordan Lee is here");
  });

  it("issues no [STUDENT_FIRST_NAME] for a single-word display name", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Art" });
    assert.deepEqual(vault.tokenNames(), ["[STUDENT_NAME]"]);
    assert.equal(vault.rehydrate(vault.pseudonymize("Art said hi")), "Art said hi");
  });

  it("keeps the capitalisation rule for a short first name", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Will Smith" });
    assert.equal(vault.pseudonymize("I will go"), "I will go");
    assert.equal(vault.pseudonymize("Will said hi"), "[STUDENT_FIRST_NAME] said hi");
  });

  it("survives sanitizeForPrompt like every other token", () => {
    assert.match("[STUDENT_FIRST_NAME]", TOKEN_GRAMMAR);
    assert.equal(sanitizeForPrompt("[STUDENT_FIRST_NAME]"), "[STUDENT_FIRST_NAME]");
  });
});

describe("DeidentifyOptions.allowlist (Wave 2 addendum)", () => {
  const CRISIS_LINE = "1-800-273-8255";
  const OFFICE = "304-555-0100";

  it("leaves an allowlisted number verbatim while tokenizing the student's own number of the same shape", () => {
    const vault = TokenVault.fromIdentity(
      { studentName: "Jordan Lee" },
      { allowlist: [CRISIS_LINE, OFFICE, "988"] },
    );
    const systemPrompt = `If you are in crisis call 988 or ${CRISIS_LINE}. The SPOKES office is ${OFFICE}.`;
    assert.equal(vault.pseudonymize(systemPrompt), systemPrompt);

    const studentTyped = "my number is 304-555-0134";
    assert.equal(vault.pseudonymize(studentTyped), "my number is [PHONE_1]");
  });

  it("protects an allowlisted value from structured substitution too", () => {
    // A program contact whose name collides with a roster name must not be
    // rewritten out of the system prompt.
    const vault = TokenVault.fromIdentity(
      { studentName: "Jordan Lee", rosterNames: ["Workforce Lee"] },
      { allowlist: ["Workforce Lee"] },
    );
    assert.equal(vault.pseudonymize("Call Workforce Lee about the grant"), "Call Workforce Lee about the grant");
    assert.equal(vault.pseudonymize("Jordan Lee is enrolled"), "[STUDENT_NAME] is enrolled");
  });

  it("does not issue a token for an allowlisted value, so nothing re-hydrates to it", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" }, { allowlist: ["988"] });
    vault.pseudonymize("call 988 now");
    assert.deepEqual(vault.tokenNames(), ["[STUDENT_FIRST_NAME]", "[STUDENT_NAME]"]);
  });

  it("an empty or absent allowlist changes nothing", () => {
    const withEmpty = TokenVault.fromIdentity({ studentName: "Jordan Lee" }, { allowlist: [] });
    const without = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    const text = "Jordan Lee at 304-555-0134";
    assert.equal(withEmpty.pseudonymize(text), without.pseudonymize(text));
  });
});
