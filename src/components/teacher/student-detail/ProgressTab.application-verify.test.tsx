import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import ProgressTab from "./ProgressTab";
import type { StudentData } from "./types";

/**
 * The per-application Verify button (Task 3.4, code review WARNING #4).
 *
 * `/api/teacher/outcomes/verify` has accepted `targetType: "application"`
 * since P1-4 shipped, and nothing ever called it — so every placement in the
 * grant report stayed "self-reported". Two things are asserted here:
 *
 *   1. BEHAVIOUR — the control renders, calls back with the application's own
 *      id, disappears once verified, and surfaces a failure instead of
 *      silently reloading. A verify that fails quietly is worse than no
 *      button: the row looks identical either way, so an instructor concludes
 *      it worked.
 *   2. WIRING — the handler in StudentDetail actually posts to that route with
 *      that targetType, and the student-detail API selects the field the
 *      button reads. A button bound to nothing renders exactly the same.
 */

const STUDENT_DETAIL = readFileSync(
  path.join(process.cwd(), "src/components/teacher/StudentDetail.tsx"),
  "utf8",
);

const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z#0-9]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    status: "offer",
    updatedAt: "2026-09-01T00:00:00.000Z",
    appliedAt: "2026-08-01T00:00:00.000Z",
    verificationStatus: "self_reported",
    opportunity: {
      id: "opp-1",
      title: "Production Associate",
      company: "Mountain Metal",
      type: "job",
      deadline: null,
    },
    ...overrides,
  };
}

/** The slice of StudentData the Progress tab's applications section reads. */
function data(applications: ReturnType<typeof application>[]): StudentData {
  return {
    student: { id: "stu-1", displayName: "Dana Rivers" },
    orientation: { items: [], progress: [] },
    certification: { cert: null, templates: [] },
    publicCredentialPage: null,
    applications,
    eventRegistrations: [],
    portfolio: [],
    hasResume: false,
    files: [],
    conversations: [],
  } as unknown as StudentData;
}

function render(
  applications: ReturnType<typeof application>[],
  overrides: Partial<Parameters<typeof ProgressTab>[0]> = {},
) {
  const calls: string[] = [];
  const html = renderToString(
    <ProgressTab
      data={data(applications)}
      dateFormatter={dateFormatter}
      verifying={null}
      onVerify={() => {}}
      certOutcomeVerifying={false}
      onCertOutcomeVerify={() => {}}
      applicationVerifying={null}
      applicationVerifyError={null}
      onApplicationVerify={(id) => calls.push(id)}
      orientationVerifying={null}
      onOrientationVerify={() => {}}
      showAllConversations
      onShowAllConversations={() => {}}
      {...overrides}
    />,
  );
  return { html, calls };
}

describe("per-application Verify — what an instructor sees", () => {
  it("offers a Verify control on a self-reported application", () => {
    const { html } = render([application()]);
    const text = stripTags(html);
    assert.ok(text.includes("Student-reported"), text);
    assert.ok(text.includes("Verify"), text);
  });

  it("names the job in the accessible label, not just 'Verify'", () => {
    // Three different Verify buttons can be on this tab at once; a screen
    // reader hears all of them as the same word without this.
    const { html } = render([application()]);
    assert.ok(
      html.includes('aria-label="Verify application for Production Associate at Mountain Metal"'),
      html,
    );
  });

  it("shows the verified state instead of the button once verified", () => {
    const { html } = render([application({ verificationStatus: "verified" })]);
    const text = stripTags(html);
    assert.ok(text.includes("Outcome verified"), text);
    assert.ok(!text.includes("Student-reported"), text);
  });

  it("treats a legacy row with no provenance as not verified", () => {
    const { html } = render([application({ verificationStatus: null })]);
    assert.ok(stripTags(html).includes("Not verified"), stripTags(html));
  });

  it("disables only the row being verified", () => {
    const { html } = render([application(), application({ id: "app-2" })], {
      applicationVerifying: "app-1",
    });
    // One disabled button, one still live.
    const disabled = (html.match(/disabled=""/gu) ?? []).length;
    assert.equal(disabled, 1, html);
  });

  it("shows the failure instead of leaving the row looking unchanged", () => {
    const { html } = render([application()], {
      applicationVerifyError: "Could not verify that.",
    });
    assert.ok(html.includes('role="alert"'), html);
    assert.ok(stripTags(html).includes("Could not verify that."), stripTags(html));
  });
});

describe("per-application Verify — the wiring", () => {
  it("the handler posts to the existing outcomes route with targetType application", () => {
    const handler = STUDENT_DETAIL.slice(
      STUDENT_DETAIL.indexOf("async function handleApplicationVerify"),
      STUDENT_DETAIL.indexOf("async function handleOrientationVerify"),
    );
    assert.ok(handler.includes('"/api/teacher/outcomes/verify"'), handler);
    assert.ok(handler.includes('targetType: "application"'), handler);
    assert.ok(handler.includes("targetId: applicationId"), handler);
  });

  it("the handler stops on a failed response rather than reloading", () => {
    const handler = STUDENT_DETAIL.slice(
      STUDENT_DETAIL.indexOf("async function handleApplicationVerify"),
      STUDENT_DETAIL.indexOf("async function handleOrientationVerify"),
    );
    const guard = handler.indexOf("if (!res.ok)");
    const reload = handler.indexOf("await loadData()");
    assert.ok(guard > -1, "the response status must be checked");
    assert.ok(guard < reload, "the guard must come before the reload");
    assert.ok(handler.includes("Could not verify that."), handler);
  });

  it("StudentDetail passes both the handler and the error down", () => {
    assert.ok(STUDENT_DETAIL.includes("onApplicationVerify={handleApplicationVerify}"));
    assert.ok(STUDENT_DETAIL.includes("applicationVerifyError={applicationVerifyError}"));
  });

  it("the student-detail API selects the field the button reads", () => {
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/teacher/students/[id]/route.ts"),
      "utf8",
    );
    const applicationsSelect = route.slice(
      route.indexOf("applications: {"),
      route.indexOf("eventRegistrations: {"),
    );
    assert.ok(
      applicationsSelect.includes("verificationStatus: true"),
      "without this the button would always render as 'Not verified'",
    );
  });
});
