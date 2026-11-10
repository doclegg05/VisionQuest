import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessReadability } from "@/lib/sage/readability";
import {
  SAGE_NOTICE_ACK_BUTTON,
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_HEADING,
  SAGE_NOTICE_INTRO,
  SAGE_NOTICE_KEY_POINTS,
  SAGE_NOTICE_SECTIONS,
  SAGE_NOTICE_VERSION,
  needsSageNotice,
} from "./notice";

// The notice is read by adults in a workforce program, many with low
// literacy. The project ceiling for UI copy is grade 8; this notice is held to
// grade 6, the ideal grade (PLAIN_LANGUAGE_IDEAL_GRADE).
const NOTICE_MAX_GRADE = 6;

const allSentences = [
  SAGE_NOTICE_INTRO,
  ...SAGE_NOTICE_SECTIONS.flatMap((section) => section.sentences),
  ...SAGE_NOTICE_KEY_POINTS,
  SAGE_NOTICE_ACK_FAILED,
];

describe("Sage notice wording", () => {
  it("has the six parts a student needs", () => {
    assert.deepEqual(
      SAGE_NOTICE_SECTIONS.map((section) => section.heading),
      [
        "What Sage Is",
        "Sage Can Be Wrong",
        "Where Your Words Go",
        "What Sage Keeps",
        "Who Can See It",
        "If You Write About Hurting Someone",
        "What You Can Ask Your Instructor",
      ],
    );
  });

  it("reads at grade 6 or below as a whole and in every section", () => {
    const whole = assessReadability(allSentences.join(" "), { maxGrade: NOTICE_MAX_GRADE });
    assert.ok(whole.grade <= NOTICE_MAX_GRADE, `whole notice grade ${whole.grade}`);
    for (const section of SAGE_NOTICE_SECTIONS) {
      const { grade } = assessReadability(section.sentences.join(" "));
      assert.ok(grade <= NOTICE_MAX_GRADE, `"${section.heading}" grade ${grade}`);
    }
  });

  it("keeps every sentence at grade 8 or below, so no single line is hard", () => {
    const hard = allSentences
      .map((text) => ({ text, grade: assessReadability(text).grade }))
      .filter(({ grade }) => grade > 8);
    assert.deepEqual(hard, []);
  });

  it("uses no dash characters", () => {
    const words = [
      ...allSentences,
      ...SAGE_NOTICE_SECTIONS.map((section) => section.heading),
      SAGE_NOTICE_ACK_HEADING,
      SAGE_NOTICE_ACK_BUTTON,
    ];
    const dashed = words.filter((text) => /[-\u2010-\u2015\u2212]/.test(text));
    assert.deepEqual(dashed, []);
  });

  it("repeats on the short version only sentences the full notice says", () => {
    const full = SAGE_NOTICE_SECTIONS.flatMap((section) => section.sentences).join(" ");
    const missing = SAGE_NOTICE_KEY_POINTS.filter((point) => !full.includes(point));
    assert.deepEqual(missing, []);
  });

  it("names a version that can be stored and compared", () => {
    assert.match(SAGE_NOTICE_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("needsSageNotice", () => {
  it("asks a real student who has not acknowledged", () => {
    assert.equal(needsSageNotice({ acknowledged: false }), true);
  });

  it("does not ask a real student who has acknowledged", () => {
    assert.equal(needsSageNotice({ acknowledged: true }), false);
  });

  it("never asks a demo account", () => {
    assert.equal(needsSageNotice({ demoAccount: "student", acknowledged: false }), false);
  });
});
