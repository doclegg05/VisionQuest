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

/**
 * How an acknowledgement is keyed in ConsentRecord: `sage_notice:<version>`.
 * It lives here, with no imports, so a seed can build the key without loading
 * the database client. src/lib/consent.ts re-exports both names.
 */
export const SAGE_NOTICE_SCOPE_PREFIX = "sage_notice:";

export function sageNoticeScope(version: string): string {
  return `${SAGE_NOTICE_SCOPE_PREFIX}${version}`;
}

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
      "Sage is an AI coach. That means a computer writes its answers, not a person.",
      "Sage can help you set goals, plan your steps, and learn about jobs and classes.",
    ],
  },
  {
    heading: "Sage Can Be Wrong",
    sentences: [
      "Sage can make mistakes.",
      "Check with your instructor before you act on something big.",
      "When Sage suggests a goal for you, your instructor checks it.",
    ],
  },
  {
    heading: "Where Your Words Go",
    sentences: [
      "When you type to Sage, your words go to a computer that runs the AI.",
      "VisionQuest has turned off outside AI services, like Google, for Sage.",
    ],
  },
  {
    heading: "What Sage Keeps",
    sentences: [
      "VisionQuest saves your chats with Sage.",
      "Sage also writes short notes about you, like your goals, so it can help you next time.",
      "You can see these short notes on the Sage Memory page.",
      "Sage also keeps a career profile from your chats. It lists things like your interests, your strengths, and your needs, like rides or child care.",
      "You can see part of your career profile on the Career page. Ask your instructor if you want to see all of it.",
      "VisionQuest also keeps your goals, the moods you share, and the files you add.",
      "VisionQuest has not set how long it keeps your information yet.",
    ],
  },
  {
    heading: "Who Can See It",
    sentences: [
      "Your instructors and other SPOKES staff can see your goals and your progress.",
      "They can also see the short notes and the career profile Sage keeps about you.",
      "They can also see the start of the last message in each chat. It may be yours or Sage's.",
      "Staff can save a copy of your information. That copy has all of your chats.",
      "If Sage has trouble saving something, staff may see part of that chat.",
      "VisionQuest keeps a record of staff who open your student page.",
    ],
  },
  {
    heading: "If You Write About Hurting Someone",
    sentences: [
      "VisionQuest looks for words about hurting yourself or someone else.",
      "It also looks for words about someone hurting you.",
      "If it finds them, it sends your instructors an alert right away.",
      "The alert does not have your words in it. Staff may still see what you wrote in other places, like the saved copy of your chats.",
      "Sage will also show you the 988 crisis line. You can call or text 988 at any time, day or night.",
      'If you pick "Really low" as your mood, your instructors get an alert too.',
      "They also get one if you tell Sage your mood is a 1 or 2 out of 10.",
    ],
  },
  {
    heading: "What You Can Ask Your Instructor",
    sentences: [
      "You can ask your instructor to fix or take out a note Sage wrote about you.",
      "You can ask if VisionQuest has set how long it keeps your information.",
      "You can ask any question about this notice.",
    ],
  },
];

/** The short version on the acknowledgement screen. Each line is a whole line of the full notice. */
export const SAGE_NOTICE_KEY_POINTS: readonly string[] = [
  "Sage is an AI coach. That means a computer writes its answers, not a person.",
  "Sage can make mistakes.",
  "VisionQuest saves your chats with Sage.",
  "Your instructors and other SPOKES staff can see your goals and your progress.",
  "They can also see the start of the last message in each chat. It may be yours or Sage's.",
  "Staff can save a copy of your information. That copy has all of your chats.",
  "If Sage has trouble saving something, staff may see part of that chat.",
  "VisionQuest looks for words about hurting yourself or someone else.",
  "If it finds them, it sends your instructors an alert right away.",
  "The alert does not have your words in it. Staff may still see what you wrote in other places, like the saved copy of your chats.",
  "Sage will also show you the 988 crisis line. You can call or text 988 at any time, day or night.",
];

export const SAGE_NOTICE_ACK_HEADING = "Before You Talk to Sage";
export const SAGE_NOTICE_ACK_INTRO =
  "Sage is the coach in this app. Read these points, then tap the button at the bottom.";
export const SAGE_NOTICE_ACK_BUTTON = "I Understand";
export const SAGE_NOTICE_ACK_PENDING = "Saving...";
export const SAGE_NOTICE_ACK_FAILED = "We could not save that. Please try again.";
/** The notice changed after this page loaded (the route answered 400). */
export const SAGE_NOTICE_ACK_STALE = "This notice just changed. Please read it again, then tap the button.";
/** The session ended before the tap (the route answered 401). */
export const SAGE_NOTICE_ACK_SIGNED_OUT = "You were signed out.";
export const SAGE_NOTICE_SIGN_IN_AGAIN = "Sign in again";
export const SAGE_NOTICE_SIGN_OUT_LINE = "Not sure? You can sign out and ask your instructor first.";
export const SAGE_NOTICE_SIGN_OUT_BUTTON = "Sign out";
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
