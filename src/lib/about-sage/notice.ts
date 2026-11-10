/**
 * The notice every student reads once before using VisionQuest (readiness
 * task H6): what Sage is, that it can be wrong, what is kept, who can see it,
 * and what happens when a student writes about hurting someone.
 *
 * Every sentence here must be true of the code. The hand-back for H6 lists the
 * file and line behind each one; change a sentence only with its source.
 *
 * Change the words, then change SAGE_NOTICE_VERSION. A student's
 * acknowledgement is stored against the version (src/lib/consent.ts), so a new
 * version asks every student again.
 */

/** Bump this whenever the notice's words change. */
export const SAGE_NOTICE_VERSION = "2026-11-10";

/** The public page with the full notice. No sign-in needed. */
export const SAGE_NOTICE_PATH = "/about-sage";

/** Where the student layout sends a student who has not acknowledged yet. */
export const SAGE_NOTICE_ACK_PATH = "/sage-notice";

export interface NoticeSection {
  readonly heading: string;
  readonly sentences: readonly string[];
}

export const SAGE_NOTICE_TITLE = "About Sage";

export const SAGE_NOTICE_INTRO =
  "Please read this before you talk to Sage. It tells you what Sage does with what you type.";

export const SAGE_NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    heading: "What Sage Is",
    sentences: [
      "Sage is an AI coach in VisionQuest.",
      "Sage can help you set goals, plan your steps, and learn about jobs and classes.",
      "Sage is a computer program. It is not a person.",
    ],
  },
  {
    heading: "Sage Can Be Wrong",
    sentences: [
      "Sage is an AI, and it can make mistakes.",
      "Check with your instructor before you act on something big.",
      "When Sage suggests a goal for you, your instructor checks it.",
    ],
  },
  {
    heading: "Where Your Words Go",
    sentences: [
      "When you type to Sage, VisionQuest sends your words to a computer that runs the AI.",
      "This program has turned off outside AI services, like Google, for Sage.",
    ],
  },
  {
    heading: "What Sage Keeps",
    sentences: [
      "VisionQuest saves your chats with Sage.",
      "Sage also writes short notes about you, like your goals, so it can help you next time.",
      "You can see these notes on the Sage Memory page.",
      "VisionQuest also keeps your goals, the moods you share, and the files you add.",
      "The program keeps your records for a set time. Your instructor can tell you how long.",
    ],
  },
  {
    heading: "Who Can See It",
    sentences: [
      "Your instructors and program staff can see your goals and your progress.",
      "They can also see the notes Sage writes about you.",
      "They can also see the newest message in each chat.",
      "Staff can save a copy of your records. That copy has all of your chats.",
      "When staff look at your records, VisionQuest writes down who looked.",
    ],
  },
  {
    heading: "If You Write About Hurting Someone",
    sentences: [
      "VisionQuest looks for words about hurting yourself or someone else.",
      "It also looks for words about someone hurting you.",
      "If it finds them, it sends your instructors an alert right away.",
      "The alert does not have your words in it.",
      "Sage will also show you the 988 crisis line. You can call or text 988 at any time, day or night.",
    ],
  },
  {
    heading: "What You Can Ask Your Instructor",
    sentences: [
      "You can ask your instructor to fix or take out a note Sage wrote about you.",
      "You can ask how long the program keeps your records.",
      "You can ask any question about this notice.",
    ],
  },
];

/** The short version on the acknowledgement screen. Each line repeats a sentence above. */
export const SAGE_NOTICE_KEY_POINTS: readonly string[] = [
  "Sage is an AI, and it can make mistakes.",
  "VisionQuest saves your chats with Sage.",
  "Your instructors and program staff can see your goals and your progress.",
  "They can also see the newest message in each chat.",
  "VisionQuest looks for words about hurting yourself or someone else.",
  "If it finds them, it sends your instructors an alert right away.",
  "Sage will also show you the 988 crisis line. You can call or text 988 at any time, day or night.",
];

export const SAGE_NOTICE_ACK_HEADING = "Before You Talk to Sage";
export const SAGE_NOTICE_ACK_BUTTON = "I Understand";
export const SAGE_NOTICE_ACK_PENDING = "Saving...";
export const SAGE_NOTICE_ACK_FAILED = "We could not save that. Please try again.";
export const SAGE_NOTICE_FULL_LINK = "Read the full notice";
export const SAGE_NOTICE_LINK_LABEL = "About Sage";

/**
 * Whether the student layout must send this student to the notice. A demo
 * account is a shared, made-up student with its own privacy notice
 * (DEMO_PRIVACY_NOTICE), so it is never asked, the same way
 * needsRecoverySetup skips it.
 */
export function needsSageNotice(input: {
  demoAccount?: string;
  acknowledged: boolean;
}): boolean {
  if (input.demoAccount !== undefined) return false;
  return !input.acknowledged;
}
