import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AMBIGUOUS_SPACE_CLASS,
  AMBIGUOUS_SPACE_RE,
  HIDEABLE_IN_MARKER_BODY,
  HIDEABLE_IN_MARKER_SOURCE,
  INVISIBLE_CHAR_RE,
  INVISIBLE_CHAR_SOURCE,
  stripInvisibleChars,
} from "./invisible-chars";

// ---------------------------------------------------------------------------
// The shared invisible-character definitions, pinned by ENUMERATION.
//
// Nothing pinned these until 2026-09-05: reverting the benchmark scorer's
// marker-collapse class to a hand-written literal left every gate green, and so
// did dropping \p{Default_Ignorable_Code_Point} or \p{Cc} from the shared class
// on its own. A definition three call sites depend on, that no test can see
// change, is a definition that will drift.
//
// The properties below are the ones the callers actually rely on, checked over
// the whole code space rather than over a sample, because the failure mode is a
// character nobody thought to sample.
// ---------------------------------------------------------------------------

const HIDEABLE_RE = new RegExp(HIDEABLE_IN_MARKER_SOURCE, "u");

/** Every scalar value, skipping the surrogate range (not valid on its own). */
function* everyCodePoint(): Generator<number> {
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    yield cp;
  }
}

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe("invisible-chars — the marker class is a superset of the removal classes", () => {
  it("HIDEABLE ⊇ invisible ∪ ambiguous spaces ∪ \\s, over every code point", () => {
    const missingInvisible: string[] = [];
    const missingSpace: string[] = [];
    const missingWhitespace: string[] = [];

    for (const cp of everyCodePoint()) {
      const ch = String.fromCodePoint(cp);
      const hideable = HIDEABLE_RE.test(ch);
      if (INVISIBLE_CHAR_RE.test(ch) && !hideable) missingInvisible.push(hex(cp));
      if (AMBIGUOUS_SPACE_RE.test(ch) && !hideable) missingSpace.push(hex(cp));
      if (/\s/u.test(ch) && !hideable) missingWhitespace.push(hex(cp));
    }

    assert.deepEqual(
      missingInvisible.slice(0, 20),
      [],
      "a character the sanitizer REMOVES can hide inside a marker without the marker class seeing it",
    );
    // NOTE, measured rather than assumed: every member of
    // AMBIGUOUS_SPACE_CLASS is currently also matched by \s, so that term in
    // the marker body is redundant TODAY and removing it reddens nothing here.
    // That is a property of the current list, not a hole in this check — add a
    // separator that is not \s (U+180E is the obvious candidate; it is Cf, not
    // whitespace) and this assertion starts carrying it.
    assert.deepEqual(missingSpace.slice(0, 20), [], "an ambiguous space is not covered by the marker class");
    assert.deepEqual(missingWhitespace.slice(0, 20), [], "ordinary whitespace is not covered by the marker class");
  });

  it("includes \\n and \\t, which the removal class deliberately exempts", () => {
    // The exemption exists because both are prompt structure. The marker class
    // must NOT inherit it: a fence split across a newline is exactly the
    // forgery the collapse is looking for.
    for (const ch of ["\n", "\t"]) {
      assert.equal(INVISIBLE_CHAR_RE.test(ch), false, `${JSON.stringify(ch)} must be exempt from removal`);
      assert.equal(HIDEABLE_RE.test(ch), true, `${JSON.stringify(ch)} must still be hideable inside a marker`);
    }
  });

  it("HIDEABLE_IN_MARKER_SOURCE is exactly its body wrapped in a class", () => {
    // The body is exported so the benchmark scorer can UNION it with its own
    // floor rather than substitute it — a scorer built only from this class
    // goes blind the moment this class narrows. If the two ever disagree, the
    // scorer is silently measuring something else.
    assert.equal(HIDEABLE_IN_MARKER_SOURCE, `[${HIDEABLE_IN_MARKER_BODY}]`);
  });
});

describe("invisible-chars — each sub-class carries weight of its own", () => {
  // One exemplar per sub-class, each covered by that sub-class ALONE. Without
  // these, dropping a whole property from the union changes no observable
  // behaviour in this file. Named rather than counted, so a Unicode data update
  // in Node cannot turn a real regression into a number that merely moved.
  const EXEMPLARS = [
    { label: "Default_Ignorable only (Lo)", ch: "\u3164", note: "HANGUL FILLER" },
    { label: "Default_Ignorable only (Mn)", ch: "\u034F", note: "COMBINING GRAPHEME JOINER" },
    { label: "Cf only", ch: "\u0600", note: "ARABIC NUMBER SIGN" },
    { label: "Cc only", ch: "\u0007", note: "BELL" },
  ] as const;

  for (const { label, ch, note } of EXEMPLARS) {
    it(`removes ${note} — ${label}`, () => {
      assert.equal(INVISIBLE_CHAR_RE.test(ch), true, `${note} must be in the removal class`);
      assert.equal(HIDEABLE_RE.test(ch), true, `${note} must be hideable inside a marker`);
      assert.equal(stripInvisibleChars(`[GROUNDING${ch}_DATA_END]`), "[GROUNDING_DATA_END]");
    });
  }

  it("the exemplars are genuinely disjoint, so each property is load-bearing", () => {
    const props = {
      dicp: /\p{Default_Ignorable_Code_Point}/u,
      cf: /\p{Cf}/u,
      cc: /\p{Cc}/u,
    };
    // HANGUL FILLER and CGJ: Default_Ignorable and nothing else.
    for (const ch of ["\u3164", "\u034F"]) {
      assert.equal(props.dicp.test(ch), true);
      assert.equal(props.cf.test(ch), false, `${hex(ch.codePointAt(0)!)} must not also be Cf`);
      assert.equal(props.cc.test(ch), false, `${hex(ch.codePointAt(0)!)} must not also be Cc`);
    }
    // ARABIC NUMBER SIGN: Cf and nothing else.
    assert.equal(props.cf.test("\u0600"), true);
    assert.equal(props.dicp.test("\u0600"), false, "U+0600 must not also be Default_Ignorable");
    assert.equal(props.cc.test("\u0600"), false);
    // BELL: Cc and nothing else.
    assert.equal(props.cc.test("\u0007"), true);
    assert.equal(props.dicp.test("\u0007"), false);
    assert.equal(props.cf.test("\u0007"), false);
  });
});

describe("invisible-chars — normalization vs removal stay distinct", () => {
  it("ambiguous spaces are normalized to a plain space, not deleted", () => {
    // Deleting them would forge markers rather than reveal them; this is the
    // 2026-09-05 round-3 finding, pinned so the remedy cannot silently flip.
    assert.equal(stripInvisibleChars("a\u00A0b"), "a b");
    assert.equal(stripInvisibleChars("a\u3000b"), "a b");
  });

  it("the ambiguous-space class never swallows the ASCII space itself", () => {
    assert.equal(AMBIGUOUS_SPACE_RE.test(" "), false);
    assert.equal(AMBIGUOUS_SPACE_CLASS.includes("\\u0020"), false);
  });

  it("the removal source keeps its \\n/\\t lookahead", () => {
    assert.ok(
      INVISIBLE_CHAR_SOURCE.startsWith("(?![\\n\\t])"),
      "the exemption is what keeps prompt structure intact — it must stay a lookahead, not a class edit",
    );
  });
});
