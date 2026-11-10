import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import StudentDetail, { showsLoadingLine } from "./StudentDetail";
import OverviewTab from "./student-detail/OverviewTab";
import ProgressTab from "./student-detail/ProgressTab";
import type { StudentData } from "./student-detail/types";

/**
 * C1, "Verify buttons report failure".
 *
 * Two kinds of test live here, and they prove different things:
 *
 *   1. SOURCE SCANS of StudentDetail.tsx. No DOM library is installed, so a
 *      click cannot be simulated. These read the file as text and fail when a
 *      write is sent without the shared helper. They prove wiring, not
 *      behaviour. The helper's behaviour is unit tested in
 *      src/lib/teacher/student-action.test.ts.
 *   2. RENDERS with renderToString, for what an instructor reads: the badge
 *      text, the password reset error and the first-load line.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/StudentDetail.tsx"),
  "utf8",
);

/** Every handler on the page that writes. A new one belongs in this list. */
const ACTION_HANDLERS = [
  "handleVerify",
  "handleCertOutcomeVerify",
  "handleApplicationVerify",
  "handleOrientationVerify",
  "handleResetPassword",
  "toggleStudentStatus",
  "handleArchive",
  "handleCreateAppointment",
  "handleAppointmentStatusChange",
  "handleCreateTask",
  "handleTaskStatusChange",
  "handleCreateNote",
  "handleGoalAction",
  "handleReviewForm",
] as const;

/** The two reads. They change nothing, so they may call fetch themselves. */
const ALLOWED_RAW_CALLS = [
  "fetch(`/api/teacher/students/${studentId}/mood`)",
  "const res = await fetch(`/api/teacher/students/${studentId}`);",
];

/** A request sent without the helper: fetch, apiFetch, or a write on the typed `api` client. */
const RAW_REQUEST = /\b(?:apiFetch|fetch)\(|\bapi\.(?:post|put|patch|del)\(/u;

/** The text of one handler, from its declaration to its closing brace. */
function handlerSource(name: string): string {
  const start = SOURCE.search(new RegExp(`(?:async function|const) ${name}\\b`, "u"));
  assert.ok(start > -1, `${name} is not declared in StudentDetail.tsx`);
  const end = SOURCE.slice(start).search(/\n {2}\};?\n/u);
  assert.ok(end > -1, `could not find the end of ${name}`);
  return SOURCE.slice(start, start + end);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z#0-9]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("StudentDetail writes go through the shared helper (source scan)", () => {
  it("calls fetch directly only for the two reads", () => {
    const rawCalls = SOURCE.split("\n")
      .map((line) => line.trim())
      .filter((line) => RAW_REQUEST.test(line));

    assert.deepEqual(
      rawCalls,
      ALLOWED_RAW_CALLS,
      "A write in StudentDetail.tsx must use sendStudentAction or runStudentAction " +
        "from src/lib/teacher/student-action.ts, so a failed request is always shown.",
    );
  });

  for (const name of ACTION_HANDLERS) {
    it(`${name} sends its request with the helper`, () => {
      assert.match(handlerSource(name), /\b(?:send|run)StudentAction\(/u);
    });
  }

  it("a handler that sends the request itself puts the failure on screen", () => {
    // runStudentAction reports for its caller. A handler that calls
    // sendStudentAction has the result in hand and must show it.
    for (const name of ACTION_HANDLERS) {
      const source = handlerSource(name);
      if (!source.includes("sendStudentAction(")) continue;
      assert.match(source, /\.message\b/u, `${name} drops the failure message`);
    }
  });

  it("the page banner is announced as an alert", () => {
    const start = SOURCE.indexOf("{panelMessage ? (");
    assert.ok(start > -1, "the panelMessage banner is gone");
    const banner = SOURCE.slice(start, SOURCE.indexOf(") : null}", start));
    assert.ok(banner.includes('role="alert"'), banner);
  });
});

describe("StudentDetail keeps the page on screen during a reload", () => {
  it("shows the loading line on the first load", () => {
    assert.equal(showsLoadingLine({ loading: true, hasData: false, hasError: false }), true);
  });

  it("keeps the student on screen while a save reloads the data", () => {
    assert.equal(showsLoadingLine({ loading: true, hasData: true, hasError: false }), false);
  });

  it("shows the loading line again when Try Again is pressed after a failed load", () => {
    assert.equal(showsLoadingLine({ loading: true, hasData: false, hasError: true }), true);
    assert.equal(showsLoadingLine({ loading: true, hasData: true, hasError: true }), true);
  });

  it("shows no loading line once loading is over", () => {
    assert.equal(showsLoadingLine({ loading: false, hasData: true, hasError: false }), false);
    assert.equal(showsLoadingLine({ loading: false, hasData: false, hasError: true }), false);
  });

  it("renders the loading line before any data has arrived", () => {
    const text = stripTags(renderToString(<StudentDetail studentId="stu-1" />));
    assert.equal(text, "Loading student data...");
  });

  it("the page asks the rule, not the bare loading flag", () => {
    // Source scan: `if (loading)` alone is what blanked the page on every save.
    assert.ok(!/if \(loading\)/u.test(SOURCE), "the page still blanks on every reload");
    assert.ok(SOURCE.includes("showsLoadingLine({"), "the loading rule is not used");
  });
});

const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
const part = { score: 0, max: 10, label: "" };

/** A student with nothing recorded, so each test adds only what it reads. */
function studentData(overrides: Partial<StudentData> = {}): StudentData {
  return {
    student: {
      id: "stu-1",
      studentId: "dana.rivers",
      displayName: "Dana Rivers",
      email: null,
      createdAt: "2026-08-01T00:00:00.000Z",
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
    ...overrides,
  };
}

function renderProgress(verificationStatus: "pending" | "declined"): string {
  const data = studentData({
    orientation: {
      items: [{ id: "item-1", label: "Tour the classroom", required: true }],
      progress: [
        { itemId: "item-1", completed: false, completedAt: null, verificationStatus, verifiedAt: null },
      ],
    },
  });
  return stripTags(
    renderToString(
      <ProgressTab
        data={data}
        dateFormatter={dateFormatter}
        verifying={null}
        onVerify={() => {}}
        certOutcomeVerifying={false}
        onCertOutcomeVerify={() => {}}
        applicationVerifying={null}
        applicationVerifyError={null}
        onApplicationVerify={() => {}}
        orientationVerifying={null}
        onOrientationVerify={() => {}}
        showAllConversations
        onShowAllConversations={() => {}}
      />,
    ),
  );
}

describe("orientation badges read as plain words", () => {
  // Each badge is checked together with the words on both sides of it, so an
  // escape code or a dash inside the badge fails the match. Other panels on
  // this tab use dashes of their own and are not this test's business.
  it("the waiting badge shows no escape code and no dash", () => {
    const text = renderProgress("pending");
    assert.ok(text.includes("Required Student marked done: verify Confirm Decline"), text);
    assert.ok(!text.includes("\\u2014"), text);
  });

  it("the declined badge shows no escape code and no dash", () => {
    const text = renderProgress("declined");
    assert.ok(text.includes("Required Declined: student will redo Ready to Work"), text);
    assert.ok(!text.includes("\\u2014"), text);
  });
});

function renderReset(resetError: string | null): string {
  return stripTags(
    renderToString(
      <OverviewTab
        data={studentData()}
        moodEntries={[]}
        dateFormatter={dateFormatter}
        showResetPw
        onToggleResetPw={() => {}}
        newPassword="short"
        onNewPasswordChange={() => {}}
        resetStatus={resetError ? "error" : "idle"}
        resetError={resetError}
        onResetPassword={() => {}}
        confirmDeactivate={false}
        onSetConfirmDeactivate={() => {}}
        deactivating={false}
        onToggleStudentStatus={() => {}}
        archiving={false}
        onArchive={() => {}}
        archiveResult={null}
        archiveError={null}
      />,
    ),
  );
}

describe("password reset says why it failed", () => {
  it("shows the server's reason in place of 'Failed'", () => {
    const text = renderReset("Password must be at least 12 characters");
    assert.ok(text.includes("Password must be at least 12 characters"), text);
    assert.ok(!/\bFailed\b/u.test(text), text);
  });

  it("shows no error text when there is no error", () => {
    const text = renderReset(null);
    assert.ok(!text.includes("Password must be at least 12 characters"), text);
    assert.ok(!/\bFailed\b/u.test(text), text);
  });

  it("StudentDetail hands the message to both copies of the tab (source scan)", () => {
    assert.equal(SOURCE.split("resetError={").length - 1, 2);
  });
});

describe("the reset panel does not keep a password it no longer needs", () => {
  // A source scan: no DOM library is installed, so the handlers cannot be clicked here.
  const source = readFileSync(new URL("./StudentDetail.tsx", import.meta.url), "utf8");

  it("clears the typed or generated password whenever the panel is opened or closed", () => {
    const toggles = source.match(/onToggleResetPw=\{[^\n]+/g) ?? [];
    assert.ok(toggles.length > 0, "no reset toggle found");
    for (const toggle of toggles) assert.match(toggle, /toggleResetPanel/);
    assert.match(source, /function toggleResetPanel\(\)[^}]*setNewPassword\(""\)/);
  });

  it("trims the password before it checks the length or sends it", () => {
    assert.match(source, /const password = newPassword\.trim\(\);/);
    assert.match(source, /body: \{ newPassword: password \}/);
  });
});
