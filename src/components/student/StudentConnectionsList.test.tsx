// =============================================================================
// The student's live introductions, and the button that takes one back.
//
// This list exists because of a gap the UX review found: the approval card
// promised "You can take it back any time" and there was nowhere to do it.
// The pending endpoint returned only `proposed` rows and the disclosure log
// only rows already sent, so between approving and sending, a connection
// appeared on NO screen the student could reach. A promise with no button is
// worse than no promise, so these cases pin the promise rather than the
// markup: the row is visible, the control is on it, and the confirmation tells
// the truth about whether anything had already gone out.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import {
  STUDENT_VISIBLE_CONNECTION_STATUSES,
  connectionStatusPhrase,
  withdrawConfirmation,
} from "@/lib/connect/pipeline-shared";

import {
  StudentConnectionsList,
  type StudentConnection,
} from "./StudentConnectionsList";

function connection(overrides: Partial<StudentConnection> = {}): StudentConnection {
  return {
    id: "conn-1",
    jobTitle: "Production Associate",
    employerName: "Mountain Metal",
    status: "student_approved",
    statusPhrase: connectionStatusPhrase("student_approved", "Mountain Metal"),
    sentOn: null,
    ...overrides,
  };
}

describe("StudentConnectionsList", () => {
  it("shows an APPROVED-BUT-NOT-YET-SENT introduction — the state that had no screen", () => {
    const html = renderToString(
      <StudentConnectionsList connections={[connection()]} />,
    );

    assert.ok(html.includes("Production Associate"));
    assert.ok(html.includes("Mountain Metal"));
    assert.ok(
      html.includes("Take this back"),
      "the take-back the approval card promised is not on the row",
    );
  });

  it("gives every student-visible status a row and a way out", () => {
    // Not just the one status the fixture happens to use. Any status a student
    // can be shown must render with the control, or the promise fails exactly
    // in the state nobody wrote a case for.
    for (const status of STUDENT_VISIBLE_CONNECTION_STATUSES) {
      const html = renderToString(
        <StudentConnectionsList
          connections={[
            connection({
              status,
              statusPhrase: connectionStatusPhrase(status, "Mountain Metal"),
            }),
          ]}
        />,
      );
      assert.ok(
        html.includes("Take this back"),
        `a "${status}" introduction cannot be taken back`,
      );
      assert.ok(
        html.includes(connectionStatusPhrase(status, "Mountain Metal")),
        `a "${status}" introduction does not say where it stands`,
      );
    }
  });

  it("renders nothing at all when there are no live introductions", () => {
    // An empty "Your job introductions" heading is a section a student has to
    // read and dismiss to learn nothing.
    assert.equal(renderToString(<StudentConnectionsList connections={[]} />), "");
  });

  it("tells the truth about whether anything had already left the program", () => {
    // The confirmation is not one string. Telling a student "we told your
    // teacher not to send this" about a packet an employer has already read
    // would be a lie they might act on — and telling them "we told Mountain
    // Metal you changed your mind" about a proposal nobody ever sent would
    // invent a conversation.
    assert.match(withdrawConfirmation("proposed", "Mountain Metal"), /your teacher/i);
    assert.match(withdrawConfirmation("student_approved", "Mountain Metal"), /your teacher/i);

    for (const sent of ["sent", "viewed", "interested", "interview_scheduled"] as const) {
      assert.match(
        withdrawConfirmation(sent, "Mountain Metal"),
        /Mountain Metal/,
        `a "${sent}" withdrawal did not name the employer who already had the packet`,
      );
    }
  });

  it("names the employer and the job in one line", () => {
    // React SSR splits interpolated text with <!-- --> markers, so the check
    // is on the rendered TEXT rather than on the raw markup — otherwise this
    // asserts a detail of the renderer instead of what a student reads.
    const text = renderToString(<StudentConnectionsList connections={[connection()]} />)
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    assert.ok(text.includes("Production Associate at Mountain Metal"), text);
  });

  it("keeps the take-back at a real touch target", () => {
    // 44px is the floor in .claude/rules/ui-patterns.md, and this button is
    // the one control on the page a student may be looking for in a hurry.
    const html = renderToString(<StudentConnectionsList connections={[connection()]} />);
    assert.ok(html.includes("min-h-[44px]"));
  });
});
