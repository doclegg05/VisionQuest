import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

import { assessReadability, PLAIN_LANGUAGE_MAX_GRADE } from "@/lib/sage/readability";

import { ConnectionApprovalCard, type PendingConnection } from "./ConnectionApprovalCard";

/**
 * The approval card is the consent moment for the whole feature, and it is
 * also the piece most likely to exist but be unreachable — the proxy.ts
 * lesson. So this file checks two different things: that the card says what a
 * student needs before tapping, and that something actually renders it.
 */
function connection(overrides: Partial<PendingConnection> = {}): PendingConnection {
  return {
    id: "conn-1",
    jobTitle: "Production Associate",
    employerName: "Mountain Metal",
    location: "Beckley, WV",
    fields: [
      "Your first name and the first letter of your last name",
      "Your résumé, written for this job",
      "The cards you earned that a teacher checked",
    ],
    endorsement: "Dana came to every class and earned the forklift card.",
    ...overrides,
  };
}

describe("ConnectionApprovalCard", () => {
  it("shows the exact field list ON the screen with the button, not behind a link", () => {
    const html = renderToString(<ConnectionApprovalCard connection={connection()} />);
    for (const field of connection().fields) {
      assert.ok(html.includes(field), `the card hid "${field}" from the student`);
    }
    assert.ok(html.includes("OK, send it"));
    // Informed consent means the list and the decision are in one place.
    assert.ok(!html.includes("See details"));
    assert.ok(!html.includes("Learn more"));
  });

  it("shows the endorsement text the teacher wrote", () => {
    const html = renderToString(<ConnectionApprovalCard connection={connection()} />);
    assert.ok(html.includes("Dana came to every class and earned the forklift card."));
  });

  it("says plainly that nothing is sent yet and that it can be taken back", () => {
    const html = renderToString(<ConnectionApprovalCard connection={connection()} />);
    assert.ok(html.includes("Nothing is sent until you say OK."));
    assert.ok(html.includes("take it back"));
  });

  it("offers exactly ONE action", () => {
    const html = renderToString(<ConnectionApprovalCard connection={connection()} />);
    // The read-aloud control is not a decision, so it does not count; what must
    // not appear is a second way to decide, like a "No" that records a refusal.
    assert.ok(!html.includes(">No<"));
    assert.ok(!html.toLowerCase().includes("decline"));
    assert.ok(!html.toLowerCase().includes("reject"));
  });

  it("reads at or below the plain-language ceiling", () => {
    // Teacher surfaces are outside the readability gate's globs and this one
    // is student-facing but assembled from props, so it is checked here with
    // the same helper the gate uses.
    // Scored on the RENDERED text, not the source: the sentences are assembled
    // from props, so a source scan would grade the template rather than what a
    // student actually reads.
    const html = renderToString(<ConnectionApprovalCard connection={connection()} />);
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const grade = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_MAX_GRADE });
    assert.ok(
      grade.withinTarget,
      `the card reads at grade ${grade.grade}, over the ceiling of ${PLAIN_LANGUAGE_MAX_GRADE}`,
    );
  });

  it("IS RENDERED: a page mounts the panel that mounts this card", () => {
    // The card and the API route can both be perfect and the feature still be
    // dead if nothing renders them. Pin the chain by source.
    const panel = readFileSync(
      join(process.cwd(), "src/components/student/PendingConnectionsPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /ConnectionApprovalCard/);
    assert.match(panel, /\/api\/connect\/pending/);

    const careerPage = readFileSync(
      join(process.cwd(), "src/app/(student)/career/page.tsx"),
      "utf8",
    );
    assert.match(careerPage, /PendingConnectionsPanel/);
    assert.match(careerPage, /<PendingConnectionsPanel \/>/);
  });

  it("IS RENDERED: the console's students board mounts the propose button", () => {
    const board = readFileSync(
      join(process.cwd(), "src/components/teacher/connect/StudentsBoard.tsx"),
      "utf8",
    );
    assert.match(board, /<ProposeConnectionButton/);

    const button = readFileSync(
      join(process.cwd(), "src/components/teacher/connect/ProposeConnectionButton.tsx"),
      "utf8",
    );
    assert.match(button, /\/api\/teacher\/connect\/connections/);
  });

  it("IS RENDERED: /memory mounts the disclosure log", () => {
    const memoryPage = readFileSync(
      join(process.cwd(), "src/app/(student)/memory/page.tsx"),
      "utf8",
    );
    assert.match(memoryPage, /<SharedWithEmployersPanel \/>/);

    const panel = readFileSync(
      join(process.cwd(), "src/components/student/SharedWithEmployersPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /\/api\/connect\/shared/);
  });
});
