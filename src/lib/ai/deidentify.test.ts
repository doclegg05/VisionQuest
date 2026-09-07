import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { TokenVault, neutralizeTokenShapes } from "./deidentify";
import { EMAIL_PATTERN, PHONE_PATTERN } from "../log-redaction";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

/** Token grammar per ticket 1C rule 1: UPPERCASE, underscores, optional numeric suffix. */
const TOKEN_GRAMMAR = /^\[[A-Z]+(?:_[A-Z]+)*(?:_\d+)?\]$/;

function fullVault(): TokenVault {
  return TokenVault.fromIdentity({
    studentName: "Jordan Lee",
    studentEmail: "jordan.lee@example.com",
    studentLoginId: "jlee2026",
    studentPhone: "+13045551234",
    staffNames: ["Mrs. Thompson", "May"],
    rosterNames: ["Lee Park", "Arturo Diaz"],
  });
}

// ─── Rule 1: placeholder grammar survives sanitizeForPrompt ──────────────────

describe("TokenVault placeholder grammar (rule 1)", () => {
  it("every token the vault can issue survives sanitizeForPrompt unchanged", () => {
    const vault = fullVault();
    // Force every free-text family to issue a token too.
    vault.pseudonymize(
      "write to sam@other.org or call (304) 555-9876, born 3/14/1987, lives at 12 Oak Street",
    );
    const names = vault.tokenNames();
    assert.ok(names.length >= 12, `expected the full token set, got ${names.join(", ")}`);
    for (const name of names) {
      assert.match(name, TOKEN_GRAMMAR, `${name} violates the token grammar`);
      assert.doesNotMatch(name, /_(START|END)\]$/, `${name} is delimiter-shaped`);
      assert.equal(sanitizeForPrompt(name), name, `sanitizeForPrompt altered ${name}`);
    }
  });

  it("issues the documented token names for structured identity", () => {
    const names = fullVault().tokenNames();
    assert.deepEqual(names, [
      "[PERSON_1]",
      "[PERSON_2]",
      "[STUDENT_EMAIL]",
      "[STUDENT_LOGIN]",
      "[STUDENT_NAME]",
      "[STUDENT_PHONE]",
      "[TEACHER_NAME_1]",
      "[TEACHER_NAME_2]",
    ]);
  });

  it("issues numbered free-text tokens per family", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    vault.pseudonymize("a@b.co, (304) 555-1212, 3/14/1987, 12 Oak Street");
    assert.deepEqual(vault.tokenNames(), [
      "[ADDRESS_1]",
      "[DOB_1]",
      "[EMAIL_1]",
      "[PHONE_1]",
      "[STUDENT_NAME]",
    ]);
  });
});

// ─── Rule 2: substitution order and anchoring ────────────────────────────────

describe("TokenVault.pseudonymize structured substitution (rule 2)", () => {
  it("replaces the full display name and the login id, longest value first", () => {
    const vault = fullVault();
    assert.equal(
      vault.pseudonymize("Jordan Lee (jlee2026) met Lee Park and Arturo Diaz today."),
      "[STUDENT_NAME] ([STUDENT_LOGIN]) met [PERSON_1] and [PERSON_2] today.",
    );
  });

  it("matches the student's own first name typed lowercase when it is 5+ chars", () => {
    const vault = fullVault();
    assert.equal(vault.pseudonymize("hey jordan"), "hey [STUDENT_NAME]");
    assert.equal(vault.pseudonymize("JORDAN!"), "[STUDENT_NAME]!");
  });

  it("matches a multi-word display name as a whole even when typed lowercase", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Will Smith" });
    assert.equal(vault.pseudonymize("Will Smith called"), "[STUDENT_NAME] called");
    assert.equal(vault.pseudonymize("will smith called"), "[STUDENT_NAME] called");
  });

  it("requires capitalisation for a name part shorter than 5 characters", () => {
    const will = TokenVault.fromIdentity({ studentName: "Will Smith" });
    assert.equal(will.pseudonymize("I will go"), "I will go");
    assert.equal(will.pseudonymize("Will said hi"), "[STUDENT_NAME] said hi");
    assert.equal(will.pseudonymize("Willa"), "Willa");

    const art = TokenVault.fromIdentity({ studentName: "Art" });
    assert.equal(art.pseudonymize("the art class"), "the art class");
    assert.equal(art.pseudonymize("Art said hi"), "[STUDENT_NAME] said hi");
    assert.equal(art.pseudonymize("Arturo"), "Arturo");
    assert.equal(art.pseudonymize("art-house"), "art-house");

    const may = TokenVault.fromIdentity({ staffNames: ["May"] });
    assert.equal(may.pseudonymize("may I ask"), "may I ask");
    assert.equal(may.pseudonymize("May is my teacher"), "[TEACHER_NAME_1] is my teacher");
  });

  it("is word-boundary anchored with Unicode letters and digits as word characters", () => {
    const vault = TokenVault.fromIdentity({ studentName: "María O'Brien" });
    assert.equal(vault.pseudonymize("maría wrote"), "[STUDENT_NAME] wrote");
    assert.equal(vault.pseudonymize("O'Brien's essay"), "[STUDENT_NAME]'s essay");
    assert.equal(vault.pseudonymize("Marías"), "Marías");
    assert.equal(vault.pseudonymize("O'Brien2"), "O'Brien2");
  });

  it("never matches a single-word roster or staff name shorter than 3 characters", () => {
    const vault = TokenVault.fromIdentity({ rosterNames: ["Al"], staffNames: ["Jo"] });
    assert.equal(vault.pseudonymize("Al and Jo said hi"), "Al and Jo said hi");
    assert.ok(vault.isEmpty, "a vault whose only names are too short to match holds no tokens");
  });

  it("matches a 3-4 character roster name only when capitalised", () => {
    const vault = TokenVault.fromIdentity({ rosterNames: ["Lee Park"] });
    assert.equal(vault.pseudonymize("Lee is here, lee is not"), "[PERSON_1] is here, lee is not");
    assert.equal(vault.pseudonymize("park the car; Park arrived"), "park the car; [PERSON_1] arrived");
  });

  it("skips honorifics when splitting a staff name into parts", () => {
    const vault = TokenVault.fromIdentity({ staffNames: ["Mrs. Thompson"] });
    assert.equal(vault.pseudonymize("Mrs. Thompson said"), "[TEACHER_NAME_1] said");
    assert.equal(vault.pseudonymize("Thompson said"), "[TEACHER_NAME_1] said");
    assert.equal(vault.pseudonymize("Mrs Baker said"), "Mrs Baker said");
  });

  it("gives a value shared by two people to the first registered token", () => {
    const vault = TokenVault.fromIdentity({
      studentName: "Jordan Lee",
      rosterNames: ["Jordan Lee", "Sam Okafor"],
    });
    assert.equal(vault.pseudonymize("Jordan Lee and Sam Okafor"), "[STUDENT_NAME] and [PERSON_1]");
    assert.deepEqual(vault.tokenNames(), ["[PERSON_1]", "[STUDENT_NAME]"]);
  });

  it("ignores blank identity values", () => {
    const vault = TokenVault.fromIdentity({
      studentName: "  ",
      studentEmail: null,
      staffNames: ["", "  "],
      rosterNames: [],
    });
    assert.ok(vault.isEmpty);
    assert.deepEqual(vault.tokenNames(), []);
  });

  it("matches the student email and login id case-insensitively", () => {
    const vault = fullVault();
    assert.equal(
      vault.pseudonymize("Mail Jordan.Lee@Example.com, login JLEE2026"),
      "Mail [STUDENT_EMAIL], login [STUDENT_LOGIN]",
    );
  });

  it("matches the student phone in any common formatting", () => {
    const vault = fullVault();
    for (const raw of ["+13045551234", "(304) 555-1234", "304-555-1234", "304.555.1234", "1 304 555 1234"]) {
      assert.equal(vault.pseudonymize(`call ${raw} now`), "call [STUDENT_PHONE] now", raw);
    }
  });
});

// ─── Rule 3: free-text detection ─────────────────────────────────────────────

describe("TokenVault free-text detection (rule 3)", () => {
  it("reuses the exported EMAIL_PATTERN and PHONE_PATTERN from log-redaction", () => {
    assert.ok(EMAIL_PATTERN instanceof RegExp);
    assert.ok(PHONE_PATTERN instanceof RegExp);
    const source = readFileSync("src/lib/ai/deidentify.ts", "utf8");
    assert.ok(source.includes("EMAIL_PATTERN"), "deidentify.ts must import EMAIL_PATTERN");
    assert.ok(source.includes("PHONE_PATTERN"), "deidentify.ts must import PHONE_PATTERN");
  });

  it("vaults emails, one numbered token per distinct value, reused on recurrence", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    const out = vault.pseudonymize("cc a@x.org and b@y.org, then a@x.org again");
    assert.equal(out, "cc [EMAIL_1] and [EMAIL_2], then [EMAIL_1] again");
    assert.equal(vault.rehydrate(out), "cc a@x.org and b@y.org, then a@x.org again");
  });

  it("vaults phones without touching bare digit runs", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.pseudonymize("call (304) 555-9876 or +1 304 555 9876"), "call [PHONE_1] or [PHONE_2]");
    assert.equal(vault.pseudonymize("I scored 304 on the test"), "I scored 304 on the test");
    assert.equal(vault.pseudonymize("room 555-A"), "room 555-A");
  });

  it("vaults numeric and month-name dates of birth but not bare years or MM/DD", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.pseudonymize("born 3/14/1987"), "born [DOB_1]");
    assert.equal(vault.pseudonymize("born 03-14-87"), "born [DOB_2]");
    assert.equal(vault.pseudonymize("born March 14, 1987"), "born [DOB_3]");
    assert.equal(vault.pseudonymize("born 14 March 1987"), "born [DOB_4]");
    assert.equal(vault.pseudonymize("born 3/14/1987 again"), "born [DOB_1] again");
    assert.equal(vault.pseudonymize("in 2019"), "in 2019");
    assert.equal(vault.pseudonymize("on 3/14"), "on 3/14");
    assert.equal(vault.pseudonymize("since May 2019"), "since May 2019");
  });

  it("vaults US street addresses but not a bare route name", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.pseudonymize("I live at 123 Main Street now"), "I live at [ADDRESS_1] now");
    assert.equal(vault.pseudonymize("mail 45 Old Mill Rd. please"), "mail [ADDRESS_2] please");
    assert.equal(vault.pseudonymize("take Route 19 north"), "take Route 19 north");
  });

  it("prefers the structured student token over a free-text token for the same value", () => {
    const vault = fullVault();
    assert.equal(
      vault.pseudonymize("jordan.lee@example.com and (304) 555-1234"),
      "[STUDENT_EMAIL] and [STUDENT_PHONE]",
    );
    assert.ok(!vault.tokenNames().includes("[EMAIL_1]"));
    assert.ok(!vault.tokenNames().includes("[PHONE_1]"));
  });

  it("does nothing to free text when freeText is false", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" }, { freeText: false });
    const text = "a@x.org, (304) 555-9876, 3/14/1987, 123 Main Street";
    assert.equal(vault.pseudonymize(text), text);
    assert.deepEqual(vault.tokenNames(), ["[STUDENT_NAME]"]);
  });

  it("round-trips every free-text token through rehydrate", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    const text = "Jordan (a@x.org, (304) 555-9876, born 14 March 1987, 123 Main Street) is ready";
    const out = vault.pseudonymize(text);
    assert.ok(!out.includes("a@x.org") && !out.includes("555-9876") && !out.includes("Main"));
    assert.equal(vault.rehydrate(out), text);
  });
});

// ─── Rule 4: re-hydration is issue-scoped ────────────────────────────────────

describe("TokenVault.rehydrate (rule 4)", () => {
  it("replaces only tokens this vault issued", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee", rosterNames: ["Lee Park"] });
    assert.equal(
      vault.rehydrate("Hi [STUDENT_NAME], [PERSON_1] and [PERSON_9] are here"),
      "Hi Jordan Lee, Lee Park and [PERSON_9] are here",
    );
  });

  it("leaves [STUDENT_NAME] untouched in a vault that has no student name", () => {
    const vault = TokenVault.fromIdentity({ rosterNames: ["Lee Park"] });
    assert.equal(vault.rehydrate("Hi [STUDENT_NAME]"), "Hi [STUDENT_NAME]");
  });

  it("does not rehydrate a token-shaped string that differs in case or spacing", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    assert.equal(vault.rehydrate("[student_name] [ STUDENT_NAME ]"), "[student_name] [ STUDENT_NAME ]");
  });

  it("escapes values for a JSON string context when asked", () => {
    const vault = TokenVault.fromIdentity({ studentName: 'Jo "JJ" O\\Neil' });
    const raw = '{"greeting":"Hi [STUDENT_NAME]!"}';
    assert.throws(() => JSON.parse(vault.rehydrate(raw)), "plain rehydrate breaks the JSON");
    const parsed = JSON.parse(vault.rehydrate(raw, { json: true })) as { greeting: string };
    assert.equal(parsed.greeting, 'Hi Jo "JJ" O\\Neil!');
  });
});

// ─── Rule 5: forgery ─────────────────────────────────────────────────────────

describe("neutralizeTokenShapes (rule 5)", () => {
  it("rewrites vault-shaped tokens in user text into a harmless visible form", () => {
    assert.equal(neutralizeTokenShapes("I am [PERSON_2] and [STUDENT_NAME]"), "I am (PERSON_2) and (STUDENT_NAME)");
    assert.equal(neutralizeTokenShapes("[ PERSON_1 ]"), "(PERSON_1)");
    assert.equal(neutralizeTokenShapes("[EMAIL_12]"), "(EMAIL_12)");
  });

  it("leaves ordinary bracketed prose alone", () => {
    for (const text of ["[sic]", "[morning shift]", "[2019]", "[A-1]", "arr[0]", "[Student_Name]"]) {
      assert.equal(neutralizeTokenShapes(text), text);
    }
  });

  it("leaves the prompt layer's own _START/_END fences alone", () => {
    // briefing.ts and tailor-application.ts send role:"user" messages wrapped
    // in [GROUNDING_DATA_START]/[GROUNDING_DATA_END]; those shapes can never be
    // vault tokens (rule 1) and sanitizeForPrompt owns them.
    const fence = "[GROUNDING_DATA_START]\nposting\n[GROUNDING_DATA_END]";
    assert.equal(neutralizeTokenShapes(fence), fence);
  });

  it("a forged [PERSON_1] cannot cause re-hydration to insert a roster name", () => {
    const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee", rosterNames: ["Lee Park"] });
    assert.ok(vault.tokenNames().includes("[PERSON_1]"));
    const outbound = vault.pseudonymize(neutralizeTokenShapes("who is [PERSON_1]?"));
    assert.ok(!outbound.includes("[PERSON_1]"), outbound);
    assert.equal(vault.rehydrate("You asked about (PERSON_1)."), "You asked about (PERSON_1).");
  });
});

// ─── Rule 6: streaming carry buffer ──────────────────────────────────────────

describe("TokenVault.createStreamRehydrator (rule 6)", () => {
  const vault = TokenVault.fromIdentity({
    studentName: "Jordan Lee",
    studentEmail: "jordan.lee@example.com",
    rosterNames: ["Lee Park"],
  });

  function viaPieces(pieces: string[]): string {
    const r = vault.createStreamRehydrator();
    return pieces.map((p) => r.push(p)).join("") + r.flush();
  }

  const singleTokenCases = [
    "",
    "no tokens here at all",
    "Hello [STUDENT_NAME], welcome back",
    "[STUDENT_NAME]",
    "[STUDENT_NAME] at the start and [ a stray bracket",
    "unknown [PERSON_9] stays",
    "[ [[ [S [ST[ nested-looking [STUDENT_[STUDENT_NAME]NAME] end",
    "[[STUDENT_NAME]]",
    "ends with a half token [STUDENT_NA",
  ];

  const twoTokenCases = [
    "[STUDENT_NAME][STUDENT_EMAIL]",
    "[STUDENT_NAME] and [PERSON_1] adjacent-ish",
    "x[PERSON_1][PERSON_1]y",
    "[STUDENT_EMAIL]\n[STUDENT_NAME]",
  ];

  it("reassembles identically for every single split point (property)", () => {
    let checked = 0;
    for (const whole of [...singleTokenCases, ...twoTokenCases]) {
      const expected = vault.rehydrate(whole);
      for (let i = 0; i <= whole.length; i += 1) {
        assert.equal(viaPieces([whole.slice(0, i), whole.slice(i)]), expected, `${JSON.stringify(whole)} split at ${i}`);
        checked += 1;
      }
    }
    assert.ok(checked > 200, `only ${checked} boundaries checked`);
  });

  it("reassembles identically for every pair of split points in the two-token cases (property)", () => {
    let checked = 0;
    for (const whole of twoTokenCases) {
      const expected = vault.rehydrate(whole);
      for (let i = 0; i <= whole.length; i += 1) {
        for (let j = i; j <= whole.length; j += 1) {
          const pieces = [whole.slice(0, i), whole.slice(i, j), whole.slice(j)];
          assert.equal(viaPieces(pieces), expected, `${JSON.stringify(whole)} split at ${i},${j}`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 1000, `only ${checked} boundary pairs checked`);
  });

  it("reassembles identically when pushed one character at a time", () => {
    for (const whole of [...singleTokenCases, ...twoTokenCases]) {
      assert.equal(viaPieces([...whole]), vault.rehydrate(whole), JSON.stringify(whole));
    }
  });

  it("never delays a lone [ by more than maxTokenLength characters", () => {
    const r = vault.createStreamRehydrator();
    assert.equal(r.push("["), "", "a lone [ is held");
    const filler = "x".repeat(vault.maxTokenLength);
    assert.equal(r.push(filler), `[${filler}`, "held bracket is released once it cannot be a prefix");
    assert.equal(r.flush(), "");
  });

  it("bounds the carry by the longest issued token", () => {
    const r = vault.createStreamRehydrator();
    const longest = Math.max(...vault.tokenNames().map((n) => n.length));
    assert.equal(vault.maxTokenLength, longest);
    let held = 0;
    const text = "abc [STUDENT_NAM";
    const emitted = r.push(text);
    held = text.length - emitted.length;
    assert.ok(held < longest, `held ${held} >= ${longest}`);
    assert.equal(emitted + r.flush(), text);
  });

  it("emits nothing for a carry that is never flushed (no leak on failure)", () => {
    const r = vault.createStreamRehydrator();
    assert.equal(r.push("Hi [STUDENT_"), "Hi ");
    // The consumer abandons the stream here; the half token is never emitted.
  });

  it("sees tokens issued after the rehydrator was created", () => {
    const live = TokenVault.fromIdentity({ studentName: "Jordan Lee" });
    const r = live.createStreamRehydrator();
    live.pseudonymize("mail sam@other.org");
    assert.equal(r.push("send it to [EMAIL_1]") + r.flush(), "send it to sam@other.org");
  });
});

// ─── Value walkers ───────────────────────────────────────────────────────────

describe("TokenVault.pseudonymizeValue / rehydrateValue", () => {
  const vault = TokenVault.fromIdentity({ studentName: "Jordan Lee", studentEmail: "jordan.lee@example.com" });

  it("deep-walks arrays and plain objects, touching only string leaves", () => {
    const input = {
      who: "Jordan Lee",
      list: ["jordan.lee@example.com", 3, null, true, { deep: "hi jordan" }],
      count: 42,
      nothing: undefined,
    };
    const out = vault.pseudonymizeValue(input) as typeof input;
    assert.deepEqual(out, {
      who: "[STUDENT_NAME]",
      list: ["[STUDENT_EMAIL]", 3, null, true, { deep: "hi [STUDENT_NAME]" }],
      count: 42,
      nothing: undefined,
    });
    assert.deepEqual(vault.rehydrateValue(out), input);
    assert.notEqual(out, input, "returns a new object rather than mutating the input");
    assert.equal(input.who, "Jordan Lee");
  });

  it("passes non-plain objects through untouched", () => {
    const when = new Date("2026-09-07T00:00:00Z");
    assert.equal(vault.pseudonymizeValue(when), when);
    assert.equal(vault.rehydrateValue(when), when);
  });
});

// ─── Rule 8 / 10: empty vault, determinism, audit ───────────────────────────

describe("TokenVault audit surface (rules 8 and 10)", () => {
  it("fromIdentity({}) is empty", () => {
    const vault = TokenVault.fromIdentity({});
    assert.equal(vault.isEmpty, true);
    assert.deepEqual(vault.tokenNames(), []);
    assert.equal(vault.maxTokenLength, 0);
    assert.equal(vault.pseudonymize("Jordan Lee"), "Jordan Lee");
    assert.equal(vault.rehydrate("[STUDENT_NAME]"), "[STUDENT_NAME]");
  });

  it("tokenNames() is sorted and never contains a value", () => {
    const vault = fullVault();
    vault.pseudonymize("sam@other.org");
    const names = vault.tokenNames();
    assert.deepEqual(names, [...names].sort());
    const values = ["Jordan", "Lee", "jlee2026", "example.com", "3045551234", "Thompson", "Park", "Diaz", "other.org"];
    for (const value of values) {
      assert.ok(!names.join(" ").includes(value), `token names leak ${value}`);
    }
  });

  it("is deterministic per vault", () => {
    const a = fullVault();
    const b = fullVault();
    const text = "Jordan Lee (jlee2026) wrote to sam@other.org about Lee Park";
    assert.equal(a.pseudonymize(text), b.pseudonymize(text));
    assert.equal(a.pseudonymize(text), a.pseudonymize(text));
  });

  it("the modules import no logger and no Prisma", () => {
    for (const file of ["src/lib/ai/deidentify.ts", "src/lib/ai/with-deidentification.ts"]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /from ["'][^"']*logger["']/, `${file} imports the logger`);
      assert.doesNotMatch(source, /logger\./, `${file} calls the logger`);
      assert.doesNotMatch(source, /@prisma|\/db["']/, `${file} imports Prisma`);
    }
  });
});

// ─── Timing sanity ───────────────────────────────────────────────────────────

describe("TokenVault timing", () => {
  it("pseudonymizes a 30 kB prompt with 20 tokens in under 50 ms", (t) => {
    const staffNames = Array.from({ length: 8 }, (_, i) => `Teacher${i} Surname${i}`);
    const rosterNames = Array.from({ length: 8 }, (_, i) => `Roster${i} Family${i}`);
    const buildStart = performance.now();
    const vault = TokenVault.fromIdentity({
      studentName: "Jordan Lee",
      studentEmail: "jordan.lee@example.com",
      studentLoginId: "jlee2026",
      studentPhone: "+13045551234",
      staffNames,
      rosterNames,
    });
    const buildMs = performance.now() - buildStart;
    assert.equal(vault.tokenNames().length, 20);

    const paragraph =
      "Jordan Lee is working with Teacher3 Surname3 and Roster5 Family5 on the résumé. " +
      "Contact jordan.lee@example.com or (304) 555-1234; the office is at 123 Main Street. " +
      "Appointment 3/14/2026. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do " +
      "eiusmod tempor incididunt ut labore et dolore magna aliqua. Will and Art and May said hi. ";
    let prompt = "";
    while (prompt.length < 30_000) prompt += paragraph;
    assert.ok(prompt.length >= 30_000 && prompt.length < 31_000);

    vault.pseudonymize(prompt); // warm the regex engine once, like the first turn does
    const start = performance.now();
    const out = vault.pseudonymize(prompt);
    const elapsed = performance.now() - start;
    t.diagnostic(`vault build ${buildMs.toFixed(2)} ms; pseudonymize 30 kB ${elapsed.toFixed(2)} ms`);
    assert.ok(!out.includes("Jordan") && !out.includes("Surname3") && !out.includes("example.com"));
    assert.ok(elapsed < 50, `pseudonymize took ${elapsed.toFixed(1)} ms`);

    const rStart = performance.now();
    vault.rehydrate(out);
    const rElapsed = performance.now() - rStart;
    t.diagnostic(`rehydrate 30 kB ${rElapsed.toFixed(2)} ms`);
    assert.ok(rElapsed < 50, `rehydrate took ${rElapsed.toFixed(1)} ms`);
  });
});
