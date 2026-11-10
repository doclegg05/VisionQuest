import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import StudentDetail, { ARCHIVE_LINK_MISSING, LoadFailed, showsLoadingLine } from "./StudentDetail";
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
 *      behaviour. Every rule the handlers follow (which message wins, which
 *      ending a status gets, when a flag is released) is a pure function,
 *      unit tested in src/lib/teacher/student-action.test.ts.
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

  it("every sendStudentAction answer has a failure branch that shows a message", () => {
    // Reading `.ok` is not enough: a handler that acts only on success hides the failure.
    for (const name of ACTION_HANDLERS) {
      const source = handlerSource(name);
      const names = [...source.matchAll(/\b(\w+) = await sendStudentAction\(/gu)].map((match) => match[1]);
      for (const result of names) {
        assert.ok(showsFailure(source, result), `${name} shows nothing when ${result} is not ok`);
      }
      const unread = (source.match(/(?<!= )await sendStudentAction\(/gu) ?? []).length;
      assert.equal(unread, 0, `${name} sends a request and ignores the answer`);
    }
  });

  it("the orientation finished call is one of the answers that is read", () => {
    const source = handlerSource("handleOrientationVerify");
    assert.match(source, /\bfinish = await sendStudentAction\(\{\s*url: "\/api\/orientation\/complete"/u);
    assert.ok(showsFailure(source, "finish"), "the finished call's failure is not shown");
  });

  it("every in-flight flag is cleared in a finally block, by the request that set it", () => {
    // Without finally, a thrown error leaves a button saying "..." for good.
    // A finally that does not clear the flag does the same.
    const SETS_IN_FLIGHT = /\b(set\w+)\((true|\w+Id|\{ kind: "saving" \})\)/gu;
    for (const name of ACTION_HANDLERS) {
      const source = handlerSource(name);
      const flags = [...source.matchAll(SETS_IN_FLIGHT)];
      if (flags.length === 0) continue;
      const cleanup = source.split("} finally {")[1];
      assert.ok(cleanup, `${name} clears its in-flight flag outside finally`);
      for (const [, setter, value] of flags) {
        const cleared = `${setter}(${clearedBy(setter, value)})`;
        assert.ok(cleanup.includes(cleared), `${name} must end with ${cleared} in its finally block`);
      }
    }
  });

  it("a single-id flag is released only by the request that still holds it", () => {
    // Two rows can be in flight at once. The first to finish must not turn the second one's button back on.
    for (const [setter, id] of Object.entries(SINGLE_ID_FLAGS)) {
      assert.ok(
        SOURCE.includes(`${setter}((current) => releaseFlag(current, ${id}))`),
        `${setter} is not released with releaseFlag(current, ${id})`,
      );
      assert.ok(!SOURCE.includes(`${setter}(null)`), `${setter}(null) clears a flag another request may hold`);
    }
  });

  it("handlers report through notify, which applies the nextNotice rule", () => {
    // The rule itself (a success never hides an error) is unit tested with nextNotice.
    assert.ok(SOURCE.includes("setNotice((showing) => nextNotice(showing, incoming))"), "notify does not apply the rule");
    assert.ok(SOURCE.includes("const page: StudentActionPage = { notify, reload: loadData };"));
    for (const name of ACTION_HANDLERS) {
      assert.ok(!handlerSource(name).includes("setNotice("), `${name} sets the message without the rule`);
    }
  });

  it("every failure goes to the one pinned message", () => {
    assert.ok(SOURCE.includes("<ActionNotice notice={notice}"), "the pinned message is not rendered");
    assert.ok(!SOURCE.includes("panelMessage"), "the old banner above the tabs is still there");
    assert.ok(!SOURCE.includes("applicationVerifyError"), "a second error line is still there");
    assert.ok(!SOURCE.includes("archiveError"), "a second error line is still there");
  });

  it("a tab change drops the message, the new password, the reset state and the open panel", () => {
    const source = handlerSource("handleTabShown");
    assert.ok(source.includes("isTabChange("), "a remount of the same tab must not count as a change");
    for (const call of ["setNotice(null)", 'setNewPassword("")', 'setReset({ kind: "idle" })', "setShowResetPw(false)"]) {
      assert.ok(source.includes(call), `a tab change does not call ${call}`);
    }
    const tabs = SOURCE.match(/<ShownTab key="(coach|progress|forms|admin)" onShown=\{\(\) => handleTabShown\("\1"\)\}>/gu) ?? [];
    assert.equal(tabs.length, 4);
  });

  it("says the archive was made when only its link is missing, and how to get the link", () => {
    assert.equal(
      ARCHIVE_LINK_MISSING,
      "The archive was made, but we could not show its download link. Press Archive Student Records again to get the link.",
    );
    // The message names a button, so the button must carry those words.
    const overview = readFileSync(path.join(process.cwd(), "src/components/teacher/student-detail/OverviewTab.tsx"), "utf8");
    assert.ok(overview.includes('"Archive Student Records"'), "the archive button is no longer called Archive Student Records");
  });

  it("uses the plain fallbacks the review asked for", () => {
    assert.ok(SOURCE.includes('"That job application was not verified."'));
    assert.ok(SOURCE.includes('"The records archive was not created."'));
    assert.ok(!SOURCE.includes("Could not verify that."));
    assert.ok(!SOURCE.includes("The archive was not made."));
    assert.ok(!SOURCE.includes("Check your connection"));
  });
});

/**
 * True when the handler shows a message if `result` came back not ok: either
 * its own `if (!result.ok)` branch that notifies an error, or an outcome
 * function that turns the failure into the message the handler then shows.
 */
function showsFailure(source: string, result: string): boolean {
  const ownBranch = new RegExp(`if \\(!${result}\\.ok\\) \\{\\s*notify\\(\\{ kind: "error"`, "u");
  const outcome = new RegExp(`\\b(?:action|orientation)Outcome\\((?:[^()]|\\([^()]*\\))*\\b${result}\\b`, "u");
  return ownBranch.test(source) || (outcome.test(source) && source.includes("notify(outcome.notice)"));
}

/** The six flags that hold the id of one row, and the id each handler holds. */
const SINGLE_ID_FLAGS: Record<string, string> = {
  setVerifying: "requirementId",
  setApplicationVerifying: "applicationId",
  setOrientationVerifying: "itemId",
  setUpdatingAppointmentId: "appointmentId",
  setUpdatingTaskId: "taskId",
  setReviewingFormId: "submissionId",
};

/** What a finally block must pass to the setter that marked a request in flight. */
function clearedBy(setter: string, value: string): string {
  if (value === "true") return "false";
  if (value === '{ kind: "saving" }') return "next";
  // One goal action runs at a time (the re-entry guard), so its flag has one holder.
  if (setter === "setGoalActionId") return "null";
  return `(current) => releaseFlag(current, ${value})`;
}

describe("StudentDetail guards against a double tap and an unwanted un-verify (source scan)", () => {
  it("a goal action already in flight does not send another", () => {
    const source = handlerSource("handleGoalAction");
    const guard = source.indexOf("if (goalActionRef.current) return;");
    assert.ok(guard > -1, "no re-entry guard");
    assert.ok(guard < source.indexOf("runStudentAction("), "the guard must come before the request");
    assert.match(source, /setGoalActionId\(goalId\)/u);
    assert.ok(SOURCE.includes("goalActionId={goalActionId}"), "GoalsPlanTab is not told which goal is busy");
    assert.match(source, /setGoalActionButton\(goalButtonFor\(action\)\)/u);
    assert.ok(SOURCE.includes("goalActionButton={goalActionButton}"), "GoalsPlanTab is not told which button was pressed");
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

describe("a failed reload still shows the message from the action before it", () => {
  const LOAD_ERROR = "Failed to load. Please try again.";

  function render(notice: { kind: "error" | "success"; text: string } | null): string {
    return renderToString(<LoadFailed error={LOAD_ERROR} onRetry={() => {}} notice={notice} onDismiss={() => {}} />);
  }

  it("shows the load failure and Try Again", () => {
    assert.equal(stripTags(render(null)), `${LOAD_ERROR} Try Again`);
  });

  it("shows the saved line of the action that worked just before the reload failed", () => {
    const html = render({ kind: "success", text: "Case note saved." });
    assert.ok(stripTags(html).includes("Case note saved."), stripTags(html));
    assert.match(html, /role="status"/u);
  });

  it("shows a failure that was on screen when the reload failed", () => {
    const html = render({ kind: "error", text: "That step was not verified. Try again." });
    assert.match(html, /role="alert"/u);
    assert.ok(stripTags(html).includes("That step was not verified. Try again."), stripTags(html));
  });

  it("the page draws its load-error branch with it (wiring)", () => {
    assert.ok(
      SOURCE.includes("<LoadFailed error={error} onRetry={retryLoad} notice={notice} onDismiss={clearNotice} />"),
      "the load-error branch does not pass the message on",
    );
  });

  it("Try Again is not a tab change, so the message is still there when the tabs come back (wiring)", () => {
    // The tabs are taken down while the load error shows and come back on the first tab.
    // isTabChange(null, tab) is false, so forgetting the old tab keeps the message.
    const source = handlerSource("retryLoad");
    assert.ok(source.includes("shownTab.current = null;"), source);
    assert.ok(source.includes("loadData()"), source);
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
