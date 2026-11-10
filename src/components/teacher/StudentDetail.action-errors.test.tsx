import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import StudentDetail, { showsLoadingLine } from "./StudentDetail";
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
  const start = SOURCE.search(new RegExp(`(?:async function|function|const) ${name}\\b`, "u"));
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

  it("every sendStudentAction result is branched on .ok", () => {
    // A result that is never read is a failure nobody sees.
    for (const name of ACTION_HANDLERS) {
      const source = handlerSource(name);
      const names = [...source.matchAll(/const (\w+) = await sendStudentAction\(/gu)].map((match) => match[1]);
      for (const result of names) {
        assert.match(source, new RegExp(`\\b${result}\\.ok\\b`, "u"), `${name} never checks ${result}.ok`);
      }
      const unread = (source.match(/(?<!= )await sendStudentAction\(/gu) ?? []).length;
      const allowed = source.includes('"/api/orientation/complete"') ? 1 : 0;
      assert.equal(unread, allowed, `${name} sends a request and ignores the answer`);
    }
  });

  it("every in-flight flag is cleared in a finally block", () => {
    // Without finally, a thrown error leaves a button saying "..." for good.
    const SETS_IN_FLIGHT = /\bset\w+\((?:true|\w+Id|\{ kind: "saving" \})\)/u;
    for (const name of ACTION_HANDLERS) {
      const source = handlerSource(name);
      if (!SETS_IN_FLIGHT.test(source)) continue;
      assert.match(source, /\} finally \{/u, `${name} clears its in-flight flag outside finally`);
    }
  });

  it("every failure goes to the one pinned message", () => {
    assert.ok(SOURCE.includes("<ActionNotice notice={notice}"), "the pinned message is not rendered");
    assert.ok(!SOURCE.includes("panelMessage"), "the old banner above the tabs is still there");
    assert.ok(!SOURCE.includes("applicationVerifyError"), "a second error line is still there");
    assert.ok(!SOURCE.includes("archiveError"), "a second error line is still there");
  });

  it("clears the message when the instructor changes tab", () => {
    const tabs = SOURCE.match(/<ShownTab key="(?:coach|progress|forms|admin)" onShown=\{clearNotice\}>/gu) ?? [];
    assert.equal(tabs.length, 4);
  });

  it("uses the plain fallbacks the review asked for", () => {
    assert.ok(SOURCE.includes('"That job application was not verified."'));
    assert.ok(SOURCE.includes('"The records archive was not created."'));
    assert.ok(!SOURCE.includes("Could not verify that."));
    assert.ok(!SOURCE.includes("The archive was not made."));
    assert.ok(!SOURCE.includes("Check your connection"));
  });
});

describe("StudentDetail guards against a double tap and an unwanted un-verify (source scan)", () => {
  it("a goal action already in flight does not send another", () => {
    const source = handlerSource("handleGoalAction");
    const guard = source.indexOf("if (goalActionRef.current) return;");
    assert.ok(guard > -1, "no re-entry guard");
    assert.ok(guard < source.indexOf("runStudentAction("), "the guard must come before the request");
    assert.match(source, /setGoalActionId\(goalId\)/u);
    assert.ok(SOURCE.includes("goalActionId={goalActionId}"), "GoalsPlanTab is not told which goal is busy");
  });

  it("asks before it removes a verification", () => {
    const source = handlerSource("handleVerify");
    const ask = source.indexOf("Remove the verification for ${label}?");
    assert.ok(ask > -1, "no confirm before un-verifying");
    assert.ok(ask < source.indexOf("runStudentAction("), "the confirm must come before the request");
  });
});

describe("StudentDetail keeps a new password on screen until it is closed (source scan)", () => {
  it("does not clear the password or close the panel on its own after a reset", () => {
    const source = handlerSource("handleResetPassword");
    assert.ok(!source.includes('setNewPassword("")'), source);
    assert.ok(!source.includes("setTimeout"), source);
    assert.ok(!source.includes("setShowResetPw(false)"), source);
  });

  it("closing the panel drops the password and the done state", () => {
    const source = handlerSource("toggleResetPanel");
    assert.ok(source.includes('setNewPassword("")'), source);
    assert.ok(source.includes('setReset({ kind: "idle" })'), source);
  });

  it("editing the field clears a stale reset failure", () => {
    const source = handlerSource("handlePasswordInput");
    assert.ok(source.includes('origin === "reset"'), source);
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
  return stripTags(renderProgressHtml(verificationStatus));
}

function renderProgressHtml(verificationStatus: "pending" | "declined"): string {
  const data = studentData({
    orientation: {
      items: [{ id: "item-1", label: "Tour the classroom", required: true }],
      progress: [
        { itemId: "item-1", completed: false, completedAt: null, verificationStatus, verifiedAt: null },
      ],
    },
  });
  return renderToString(
      <ProgressTab
        data={data}
        dateFormatter={dateFormatter}
        verifying={null}
        onVerify={() => {}}
        certOutcomeVerifying={false}
        onCertOutcomeVerify={() => {}}
        applicationVerifying={null}
        onApplicationVerify={() => {}}
        orientationVerifying={null}
        onOrientationVerify={() => {}}
        showAllConversations
        onShowAllConversations={() => {}}
      />,
  );
}

describe("orientation badges read as plain words", () => {
  // Each badge is checked together with the words on both sides of it, so an
  // escape code or a dash inside the badge fails the match. Other panels on
  // this tab use dashes of their own and are not this test's business.
  it("the waiting badge shows no escape code and no dash", () => {
    const text = renderProgress("pending");
    assert.ok(text.includes("Not done Tour the classroom Required Student says done Confirm Send back"), text);
    assert.ok(!text.includes("\\u2014"), text);
  });

  it("the buttons are named for the step they act on", () => {
    const html = renderProgressHtml("pending");
    assert.ok(html.includes('aria-label="Confirm orientation step: Tour the classroom"'), html);
    assert.ok(html.includes('aria-label="Send back orientation step: Tour the classroom"'), html);
  });

  it("the done and not done marks are hidden from screen readers and named in words", () => {
    const html = renderProgressHtml("pending");
    assert.match(html, /<span aria-hidden="true"[^>]*>○<\/span><span class="sr-only">Not done<\/span>/u);
  });

  it("the declined badge shows no escape code and no dash", () => {
    const text = renderProgress("declined");
    assert.ok(text.includes("Required Sent back to student Ready to Work"), text);
    assert.ok(!text.includes("\\u2014"), text);
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
