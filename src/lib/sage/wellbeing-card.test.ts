import assert from "node:assert/strict";
import test from "node:test";
import {
  WELLBEING_RESPONSE_CHECKLIST,
  formatWellbeingCardSummary,
  formatWellbeingQueueLine,
  parseWellbeingCardSummary,
} from "./wellbeing-card";

// The builder (crisis-detection) and parser (teacher UIs) must stay in
// lockstep — these tests pin the round-trip contract.

const DETECTED_AT = new Date("2026-07-20T14:32:00.000Z");

test("card round-trips through the parser with a mood entry", () => {
  const summary = formatWellbeingCardSummary({
    category: "self_harm",
    detectedAt: DETECTED_AT,
    mood: { score: 2, recordedAt: new Date("2026-07-12T09:00:00.000Z") },
  });

  const parsed = parseWellbeingCardSummary(summary);
  assert.ok(parsed);
  assert.equal(parsed.categoryLabel, "Self-harm language");
  assert.equal(parsed.detectedLabel, "2026-07-20 14:32 UTC");
  assert.equal(parsed.moodLabel, "2/10 (2026-07-12)");
  assert.deepEqual(parsed.checklist, [...WELLBEING_RESPONSE_CHECKLIST]);
  assert.ok(parsed.lead.includes("No message text is stored for privacy"));
});

test("card round-trips without a mood entry", () => {
  const summary = formatWellbeingCardSummary({
    category: "low_mood",
    detectedAt: DETECTED_AT,
    mood: null,
  });

  const parsed = parseWellbeingCardSummary(summary);
  assert.ok(parsed);
  assert.equal(parsed.categoryLabel, "Very low mood score");
  assert.equal(parsed.moodLabel, null);
  assert.equal(parsed.checklist.length, WELLBEING_RESPONSE_CHECKLIST.length);
});

test("a null category falls back to a generic label", () => {
  const summary = formatWellbeingCardSummary({
    category: null,
    detectedAt: DETECTED_AT,
    mood: null,
  });
  assert.equal(
    parseWellbeingCardSummary(summary)?.categoryLabel,
    "Concerning language in chat",
  );
});

test("parser rejects legacy prose summaries so callers fall back to raw text", () => {
  const legacy =
    "A student may have shared something serious in a Sage conversation. " +
    "Please check in with them directly.";
  assert.equal(parseWellbeingCardSummary(legacy), null);
  assert.equal(parseWellbeingCardSummary(""), null);
  assert.equal(formatWellbeingQueueLine(legacy), null);
});

test("queue line collapses the card to one actionable sentence", () => {
  const summary = formatWellbeingCardSummary({
    category: "abuse",
    detectedAt: DETECTED_AT,
    mood: { score: 3, recordedAt: new Date("2026-07-15T00:00:00.000Z") },
  });
  assert.equal(
    formatWellbeingQueueLine(summary),
    "Possible abuse disclosure · Mood 3/10 (2026-07-15) — review the crisis card and reach out directly.",
  );

  const noMood = formatWellbeingCardSummary({
    category: "harm_others",
    detectedAt: DETECTED_AT,
    mood: null,
  });
  assert.equal(
    formatWellbeingQueueLine(noMood),
    "Harm-to-others language — review the crisis card and reach out directly.",
  );
});
