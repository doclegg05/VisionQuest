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

/** The open reset controls, from the field's label to the Reset button. */
function resetControls(newPassword: string): string {
  const html = renderToString(
    <OverviewTab
      data={DATA}
      moodEntries={[]}
      dateFormatter={new Intl.DateTimeFormat("en-US", { timeZone: "UTC" })}
      showResetPw
      onToggleResetPw={noop}
      newPassword={newPassword}
      onNewPasswordChange={noop}
      resetStatus="idle"
      onResetPassword={noop}
      confirmDeactivate={false}
      onSetConfirmDeactivate={noop}
      deactivating={false}
      onToggleStudentStatus={noop}
      archiving={false}
      onArchive={noop}
      archiveResult={null}
      archiveError={null}
    />,
  );
  const start = html.indexOf('<label for="reset-password-input"');
  const end = html.indexOf(">Reset</button>");
  assert.ok(start >= 0 && end > start, "the reset controls did not render");
  return html.slice(start, end + ">Reset</button>".length).replace(/<!--[\s\S]*?-->/gu, "");
}

function tag(html: string, pattern: RegExp, name: string): string {
  const match = html.match(pattern);
  assert.ok(match, `no ${name}`);
  return match[0];
}

const field = (html: string) => tag(html, /<input\b[^>]*\bid="reset-password-input"[^>]*>/u, "password field");
const resetButton = (html: string) => tag(html, /<button\b[^>]*>Reset<\/button>/u, "Reset button");
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

  it("ties the length hint to the field for screen readers", () => {
    const html = resetControls("");
    const hintId = field(html).match(/aria-describedby="([^"]+)"/u)?.[1];
    assert.ok(hintId, "the field has no aria-describedby");
    assert.ok(html.includes(`id="${hintId}"`), "aria-describedby points at nothing");
  });
});

describe("instructor password reset: Make a password", () => {
  it("offers the button beside the field", () => {
    assert.match(resetControls(""), /<button\b[^>]*\stype="button"[^>]*>Make a password<\/button>/u);
  });

  it("fills the field with a generated password when pressed (wiring)", () => {
    const button = tag(SOURCE, /<button\b(?:(?!<button\b)[\s\S])*?>\s*Make a password\s*<\/button>/u, "Make a password button");
    assert.ok(
      button.includes("onNewPasswordChange(generatePassword())"),
      "the button must pass generatePassword() to onNewPasswordChange",
    );
  });
});
