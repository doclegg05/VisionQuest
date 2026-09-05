import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The per-application Verify button (Task 3.4).
 *
 * `/api/teacher/outcomes/verify` has accepted `targetType: "application"`
 * since P1-4 shipped, and nothing ever called it — so every placement in the
 * grant report stayed "self-reported". The wiring proof is what matters here:
 * the button exists AND its handler posts to that route with that targetType.
 * A button that renders but calls nothing is the failure mode this test is
 * written against.
 */

const PROGRESS_TAB = readFileSync(
  path.join(process.cwd(), "src/components/teacher/student-detail/ProgressTab.tsx"),
  "utf8",
);
const STUDENT_DETAIL = readFileSync(
  path.join(process.cwd(), "src/components/teacher/StudentDetail.tsx"),
  "utf8",
);

describe("per-application outcome verification", () => {
  it("ProgressTab renders a Verify control bound to onApplicationVerify", () => {
    assert.ok(
      PROGRESS_TAB.includes("onApplicationVerify(application.id)"),
      "the button must pass the application's own id",
    );
    assert.ok(PROGRESS_TAB.includes("applicationVerifying === application.id"));
  });

  it("StudentDetail passes the handler down — the button is not orphaned", () => {
    assert.ok(STUDENT_DETAIL.includes("onApplicationVerify={handleApplicationVerify}"));
    assert.ok(STUDENT_DETAIL.includes("applicationVerifying={applicationVerifying}"));
  });

  it("the handler posts to the existing outcomes route with targetType application", () => {
    const handler = STUDENT_DETAIL.slice(
      STUDENT_DETAIL.indexOf("async function handleApplicationVerify"),
      STUDENT_DETAIL.indexOf("async function handleOrientationVerify"),
    );
    assert.ok(handler.includes('"/api/teacher/outcomes/verify"'), handler);
    assert.ok(handler.includes('targetType: "application"'), handler);
    assert.ok(handler.includes("targetId: applicationId"), handler);
    assert.ok(handler.includes("await loadData()"), "the row must refresh after verifying");
  });

  it("shows the verified state instead of the button once it is verified", () => {
    assert.ok(PROGRESS_TAB.includes('application.verificationStatus === "verified"'));
    assert.ok(PROGRESS_TAB.includes("Outcome verified"));
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
