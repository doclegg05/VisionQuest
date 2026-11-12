import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessReadability } from "@/lib/sage/readability";
import { readFileSync } from "node:fs";
import {
  SAGE_CHAT_AI_LINE,
  SAGE_CHAT_NOTICE_LINK,
  SAGE_CHAT_NOTICE_NEW_TAB,
  SAGE_NOTICE_ACK_BUTTON,
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_HEADING,
  SAGE_NOTICE_ACK_INTRO,
  SAGE_NOTICE_ACK_SIGNED_OUT,
  SAGE_NOTICE_ACK_STALE,
  SAGE_NOTICE_INTRO,
  SAGE_NOTICE_SIGN_IN_AGAIN,
  SAGE_NOTICE_SIGN_OUT_BUTTON,
  SAGE_NOTICE_SIGN_OUT_LINE,
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
  SAGE_NOTICE_ACK_INTRO,
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_STALE,
  SAGE_NOTICE_ACK_SIGNED_OUT,
  SAGE_NOTICE_SIGN_OUT_LINE,
  SAGE_CHAT_AI_LINE,
  SAGE_CHAT_NOTICE_LINK,
  SAGE_CHAT_NOTICE_NEW_TAB,
];

const fullItems = SAGE_NOTICE_SECTIONS.flatMap((section) => section.sentences);

function sectionText(heading: string): string {
  const section = SAGE_NOTICE_SECTIONS.find((s) => s.heading === heading);
  assert.ok(section, `no section "${heading}"`);
  return section.sentences.join(" ");
}

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

  it("keeps every line at grade 6 or below, so no single line is hard", () => {
    const hard = allSentences
      .map((text) => ({ text, grade: assessReadability(text).grade }))
      .filter(({ grade }) => grade > NOTICE_MAX_GRADE);
    assert.deepEqual(hard, []);
  });

  it("uses no dash characters", () => {
    const words = [
      ...allSentences,
      ...SAGE_NOTICE_SECTIONS.map((section) => section.heading),
      SAGE_NOTICE_ACK_HEADING,
      SAGE_NOTICE_ACK_BUTTON,
      SAGE_NOTICE_SIGN_OUT_BUTTON,
      SAGE_NOTICE_SIGN_IN_AGAIN,
    ];
    const dashed = words.filter((text) => /[-\u2010-\u2015\u2212]/.test(text));
    assert.deepEqual(dashed, []);
  });

  it("repeats on the short version only whole lines of the full notice", () => {
    const missing = SAGE_NOTICE_KEY_POINTS.filter((point) => !fullItems.includes(point));
    assert.deepEqual(missing, []);
  });

  it("names a version that can be stored and compared", () => {
    assert.match(SAGE_NOTICE_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// Each test below pins one sentence to what the code does today. The H6b
// hand-back names the file and line behind each; if the code changes, change
// the sentence and SAGE_NOTICE_VERSION together.
describe("Sage notice tells the truth", () => {
  it("explains AI the first time it is used, then does not repeat it", () => {
    const first = fullItems.findIndex((item) => /\bAI\b/.test(item));
    assert.equal(fullItems[first], "Sage is an AI coach. That means a computer writes its answers, not a person.");
    assert.equal(SAGE_NOTICE_KEY_POINTS[0], fullItems[first]);
    assert.equal(fullItems.filter((item) => /not a person/.test(item)).length, 1);
  });

  it("says staff see the start of the last message, which may be Sage's", () => {
    // teacher/students/[id] loads the newest message of either role, cut to 150 characters.
    const words = fullItems.join(" ");
    assert.doesNotMatch(words, /newest message|last thing you said/);
    assert.ok(fullItems.includes("They can also see the start of the last message in each chat. It may be yours or Sage's."));
  });

  it("puts the saved copy and the failed save on the short version, after the last message line", () => {
    const at = SAGE_NOTICE_KEY_POINTS.indexOf(
      "They can also see the start of the last message in each chat. It may be yours or Sage's.",
    );
    assert.ok(at >= 0);
    assert.deepEqual(SAGE_NOTICE_KEY_POINTS.slice(at + 1, at + 3), [
      "Staff can save a copy of your information. That copy has all of your chats.",
      "If Sage has trouble saving something, staff may see part of that chat.",
    ]);
  });

  it("names the career profile in what is kept and who can see it", () => {
    assert.match(sectionText("What Sage Keeps"), /career profile/);
    assert.match(sectionText("Who Can See It"), /career profile/);
  });

  it("does not say the career profile is on the Sage Memory page", () => {
    const memoryLine = fullItems.find((item) => item.includes("Sage Memory page"));
    assert.ok(memoryLine);
    assert.doesNotMatch(memoryLine, /career/);
    // The student Career pages show Sage's summary and the scores, not the full lists.
    assert.match(sectionText("What Sage Keeps"), /Career page/);
  });

  it("claims a staff view record only for the student page", () => {
    const words = fullItems.join(" ");
    assert.doesNotMatch(words, /writes down who looked/);
    assert.ok(fullItems.includes("VisionQuest keeps a record of staff who open your student page."));
  });

  it("does not claim a set retention time", () => {
    const words = fullItems.join(" ");
    assert.doesNotMatch(words, /for a set time/);
    assert.ok(fullItems.includes("VisionQuest has not set how long it keeps your information yet."));
    assert.match(sectionText("What You Can Ask Your Instructor"), /has set how long/);
  });

  it("says a very low mood alerts instructors, by the label the check-in card shows", () => {
    const crisis = sectionText("If You Write About Hurting Someone");
    assert.match(crisis, /"Really low"/);
    assert.match(crisis, /1 or 2 out of 10/);
    const card = readFileSync("src/components/dashboard/MoodCheckInCard.tsx", "utf8");
    assert.match(card, /score: 2, emoji: "[^"]+", label: "Really low"/);
  });

  it("follows the no words line with a warning that staff may still see the message", () => {
    const line = "The alert does not have your words in it. Staff may still see what you wrote in other places, like the saved copy of your chats.";
    assert.ok(fullItems.includes(line));
    assert.ok(SAGE_NOTICE_KEY_POINTS.includes(line));
  });

  // Round 2 truth check (2026-11-11).
  it("says the Career page comes later: its nav link opens at phase 3", () => {
    assert.ok(fullItems.includes("Later, you can see part of your career profile on the Career page. Ask your instructor if you want to see all of it."));
    const nav = readFileSync("src/lib/nav-items.ts", "utf8");
    assert.match(nav, /label: "Career",[^}]*phase: 3/);
  });

  it("says a mood told to Sage may alert, and only when Sage checks in", () => {
    assert.ok(fullItems.includes("They may also get one if you tell Sage your mood is a 1 or 2 out of 10 when Sage checks in with you."));
    const post = readFileSync("src/lib/chat/post-response.ts", "utf8");
    assert.match(post, /mood: input\.conversationStage === "checkin" \|\| input\.conversationStage === "review"/);
  });

  it("says staff can see the moods a student shares, in the notice and on the held screen", () => {
    const line = "Your instructors and other SPOKES staff can see your goals, your moods, and your progress.";
    assert.ok(fullItems.includes(line));
    assert.ok(SAGE_NOTICE_KEY_POINTS.includes(line));
    assert.match(readFileSync("src/app/api/teacher/students/[id]/mood/route.ts", "utf8"), /export const GET = withTeacherAuth\(/);
  });

  it("says VisionQuest, not the program, turned off outside AI", () => {
    assert.ok(fullItems.includes("VisionQuest has turned off outside AI tools, like Google, for Sage."));
    assert.doesNotMatch(fullItems.join(" "), /This program|program staff/);
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
