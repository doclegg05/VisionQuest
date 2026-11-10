import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

import OverviewTab from "./OverviewTab";
import type { StudentData } from "./types";

/**
 * The instructor's password reset, as it is drawn.
 *
 * The screen asked for "6+ chars" and turned Reset on at six, while the server
 * wanted 12, so a reset typed as told failed. The field was also masked, so
 * the instructor could not read back what they had typed for the student.
 *
 * BEHAVIOUR is read from the rendered HTML. WIRING (what the Make a password
 * button does when pressed) is read from the source, because no DOM library
 * is installed to press it.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/teacher/student-detail/OverviewTab.tsx"),
  "utf8",
);

const noop = () => {};
const part = { score: 0, max: 10, label: "" };

const DATA: StudentData = {
  student: {
    id: "stu-1",
    studentId: "drivers",
    displayName: "Dana Rivers",
    email: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isActive: true,
    programType: "spokes",
  },
  progression: { xp: 0, level: 1, streaks: { daily: { current: 0, longest: 0 } }, achievements: [] },
  readinessScore: 0,
  readinessBreakdown: {
    orientation: part,
    goalPlanning: part,
    bhagAchieved: part,
    certifications: part,
    portfolio: part,
    consistency: part,
  },
  goals: [],
  goalPlans: [],
  goalEvidence: [],
  reviewQueue: [],
  formSubmissions: [],
  orientation: { items: [], progress: [] },
  certification: { templates: [], cert: null },
  publicCredentialPage: null,
  applications: [],
  eventRegistrations: [],
  portfolio: [],
  hasResume: false,
  files: [],
  appointments: [],
  tasks: [],
  notes: [],
  alerts: [],
  conversations: [],
  careerDiscovery: null,
  workProfile: null,
};

function renderOverview(newPassword: string, resetStatus: "idle" | "saving" | "done" = "idle"): string {
  return renderToString(
    <OverviewTab
      data={DATA}
      moodEntries={[]}
      dateFormatter={new Intl.DateTimeFormat("en-US", { timeZone: "UTC" })}
      showResetPw
      onToggleResetPw={noop}
      newPassword={newPassword}
      onNewPasswordChange={noop}
      resetStatus={resetStatus}
      onResetPassword={noop}
      confirmDeactivate={false}
      onSetConfirmDeactivate={noop}
      deactivating={false}
      onToggleStudentStatus={noop}
      archiving={false}
      onArchive={noop}
      archiveResult={null}
    />,
  );
}

/** The open reset controls, from the field's label to the Reset password button. */
function resetControls(newPassword: string): string {
  const html = renderOverview(newPassword);
  const start = html.indexOf('<label for="reset-password-input"');
  const end = html.indexOf(">Reset password</button>");
  assert.ok(start >= 0 && end > start, "the reset controls did not render");
  return html.slice(start, end + ">Reset password</button>".length).replace(/<!--[\s\S]*?-->/gu, "");
}

function tag(html: string, pattern: RegExp, name: string): string {
  const match = html.match(pattern);
  assert.ok(match, `no ${name}`);
  return match[0];
}

const field = (html: string) => tag(html, /<input\b[^>]*\bid="reset-password-input"[^>]*>/u, "password field");
const resetButton = (html: string) => tag(html, /<button\b[^>]*>Reset password<\/button>/u, "Reset password button");
/** The attribute, not the `disabled:` Tailwind variant in the class list. */
const DISABLED = /\sdisabled=""/u;

/** Every number the instructor can read: placeholder text and visible text. */
function numbersOnScreen(html: string): number[] {
  const placeholders = [...html.matchAll(/placeholder="([^"]*)"/gu)].map((match) => match[1]);
  const text = html.replace(/<[^>]+>/gu, " ");
  return [...[...placeholders, text].join(" ").matchAll(/\d+/gu)].map((match) => Number(match[0]));
}

describe("instructor password reset: what the screen says", () => {
  it("states the length the server enforces, and no other number", () => {
    const stated = numbersOnScreen(resetControls(""));

    assert.ok(stated.length > 0, "the screen never says how long the password must be");
    assert.deepEqual([...new Set(stated)], [MIN_PASSWORD_LENGTH]);
  });

  it("says the generated password uses only small letters and numbers", () => {
    assert.ok(resetControls("").includes("All small letters and numbers."));
  });

  for (const length of [6, MIN_PASSWORD_LENGTH - 1]) {
    it(`keeps Reset off at ${length} characters, which the server would refuse`, () => {
      assert.match(resetButton(resetControls("a".repeat(length))), DISABLED);
    });
  }

  it("turns Reset on at the length the server accepts", () => {
    assert.doesNotMatch(resetButton(resetControls("a".repeat(MIN_PASSWORD_LENGTH))), DISABLED);
  });
});

describe("instructor password reset: the field", () => {
  it("shows the password as plain text so the instructor can read it to the student", () => {
    assert.match(field(resetControls("")), /\stype="text"/u);
  });

  it("keeps the browser from saving, correcting or capitalising the password", () => {
    // HTML attribute names ignore case, and React writes some in camelCase.
    const input = field(resetControls("")).toLowerCase();
    for (const attribute of ['autocomplete="off"', 'autocapitalize="none"', 'autocorrect="off"', 'spellcheck="false"']) {
      assert.ok(input.includes(attribute), `the field needs ${attribute}`);
    }
  });

  it("is at least 44px tall on touch screens", () => {
    assert.match(field(resetControls("")), /pointer-coarse:min-h-11/u);
  });

  it("ties the length hint to the field for screen readers", () => {
    const html = resetControls("");
    const hintId = field(html).match(/aria-describedby="([^"]+)"/u)?.[1];
    assert.ok(hintId, "the field has no aria-describedby");
    assert.ok(html.includes(`id="${hintId}"`), "aria-describedby points at nothing");
  });
});

describe("instructor password reset: Make a password for me", () => {
  it("offers the button beside the field", () => {
    assert.match(resetControls(""), /<button\b[^>]*\stype="button"[^>]*>Make a password for me<\/button>/u);
  });

  it("fills the field with a generated password when pressed (wiring)", () => {
    const button = tag(SOURCE, /<button\b(?:(?!<button\b)[\s\S])*?>\s*Make a password for me\s*<\/button>/u, "Make a password button");
    assert.ok(
      button.includes("onNewPasswordChange(generatePassword())"),
      "the button must pass generatePassword() to onNewPasswordChange",
    );
    assert.ok(button.includes("setMadePassword(true)"), "the screen reader line must be turned on");
  });

  it("keeps a polite screen reader line ready for the new password", () => {
    assert.match(resetControls(""), /<p\b[^>]*aria-live="polite"[^>]*class="sr-only"/u);
    assert.match(SOURCE, /A new password is in the box\./u);
  });
});

describe("instructor password reset: the toggle", () => {
  it("says whether the panel is open", () => {
    const open = renderOverview("");
    assert.match(tag(open, /<button\b[^>]*>Reset Password<\/button>/u, "toggle"), /aria-expanded="true"/u);
  });
});

describe("instructor password reset: after it works", () => {
  const html = renderOverview("k7mq-x2vd-p9rt", "done");
  const words = html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

  it("keeps the password on screen in a monospace line until Close", () => {
    assert.ok(
      words.includes("Password changed. Give the student this password: k7mq-x2vd-p9rt They are now signed out everywhere else. Close"),
      words,
    );
    assert.match(html, /<p\b[^>]*class="[^"]*\bfont-mono\b[^"]*"[^>]*>k7mq-x2vd-p9rt<\/p>/u);
  });

  it("replaces the controls and says it worked only once", () => {
    assert.doesNotMatch(html, /id="reset-password-input"/u);
    assert.equal(words.split("Password changed").length - 1, 1);
    assert.ok(!words.includes("Done!"), words);
  });

  it("Close is a 44px button that closes the panel (wiring)", () => {
    const close = tag(html, /<button\b[^>]*>Close<\/button>/u, "Close button");
    assert.match(close, /\bmin-h-11\b/u);
    assert.match(SOURCE, /onClick=\{onClose\}\s*>\s*Close/u);
    assert.match(SOURCE, /<ResetDonePanel password=\{newPassword\} onClose=\{onToggleResetPw\} \/>/u);
  });
});
