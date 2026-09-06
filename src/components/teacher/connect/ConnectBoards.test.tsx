import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";

import { EmployerDirectory, type EmployerDirectoryItem } from "./EmployerDirectory";
import { LeadsBoard, type LeadsBoardItem } from "./LeadsBoard";
import { StudentsBoard, type StudentsBoardItem } from "./StudentsBoard";

/**
 * The three read-only boards of the job developer console (Task 3.4).
 *
 * Teacher surfaces are outside `ui-copy:readability`'s globs, so the grade-6
 * assertions here are the only gate on this page's copy. The empty states and
 * the subsidy wording matter most: they are what an instructor reads on the
 * day the console has nothing in it, and what stops a dollar figure nobody has
 * signed off from reaching a screen.
 */

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function assertGradeSix(html: string, label: string) {
  const text = stripTags(html);
  const readability = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
  assert.ok(
    readability.withinTarget,
    `${label} reads at grade ${readability.grade}: ${text}`,
  );
}

const lead: LeadsBoardItem = {
  id: "lead-1",
  title: "Production Associate",
  employerName: "Mountain Metal",
  location: "Beckley, WV",
  pay: "$15 an hour.",
  shifts: ["day"],
  className: null,
  openings: 2,
  fitCount: 4,
  blockedCount: 2,
  blocked: [
    {
      studentId: "stu-1",
      displayName: "Sam Ford",
      reason: "Needs the forklift operator card. Not earned yet.",
    },
    {
      studentId: "stu-2",
      displayName: "Kim Adams",
      reason: "No way to get there yet.",
    },
  ],
};

describe("LeadsBoard", () => {
  it("shows the fit and blocked counts an instructor acts on", () => {
    const html = renderToString(<LeadsBoard leads={[lead]} />);
    assert.ok(html.includes("4 fit / 2 blocked"), html);
    assert.ok(html.includes("Production Associate"), html);
    assert.ok(html.includes("Mountain Metal"), html);
  });

  it("says the shift and the pay in words, not codes", () => {
    const html = renderToString(<LeadsBoard leads={[lead]} />);
    assert.ok(html.includes("Day shift"), html);
    assert.ok(!html.includes('"day"'), html);
  });

  it("says 'All classes' rather than leaving a program-wide lead unlabelled", () => {
    const html = renderToString(<LeadsBoard leads={[lead]} />);
    assert.ok(html.includes("All classes"), html);
  });

  it("says pay is not listed rather than showing a blank", () => {
    const html = renderToString(<LeadsBoard leads={[{ ...lead, pay: null, shifts: [] }]} />);
    assert.ok(html.includes("Pay not listed."), html);
  });

  it("shows WHO is blocked and why, not just a count", () => {
    // fit() has produced these sentences since Phase 3 shipped and nothing
    // rendered them, so an instructor saw "4 fit / 2 blocked" with no way to
    // learn that one of the two just needs a certificate.
    const html = renderToString(<LeadsBoard leads={[lead]} />);
    assert.ok(html.includes("Who is blocked, and why"), html);
    assert.ok(html.includes("Sam Ford"), html);
    assert.ok(html.includes("Needs the forklift operator card"), html);
  });

  it("summarises the rest when more are blocked than are listed", () => {
    // Stripped text, because React inserts comment separators around every
    // interpolated value and the assertion is about what a person reads.
    const text = stripTags(
      renderToString(<LeadsBoard leads={[{ ...lead, blockedCount: 9, fitCount: 1 }]} />),
    );
    assert.ok(text.includes("and 7 more"), text);
  });

  it("omits the disclosure entirely when nobody is blocked", () => {
    const html = renderToString(
      <LeadsBoard leads={[{ ...lead, blocked: [], blockedCount: 0 }]} />,
    );
    assert.ok(!html.includes("Who is blocked"), html);
  });

  it("offers a filter and collapses past ten leads", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      ...lead,
      id: `lead-${index}`,
      title: `Job ${index}`,
    }));
    const html = renderToString(<LeadsBoard leads={many} />);
    assert.ok(html.includes('id="leads-filter"'), "a board with no filter is unusable by term two");
    assert.ok(stripTags(html).includes("Show 4 more leads"), stripTags(html));
    assert.ok(!html.includes("Job 13"), "the eleventh onward are behind Show more");
  });

  it("gives an empty board a next step, at grade 6", () => {
    const html = renderToString(<LeadsBoard leads={[]} />);
    assert.ok(html.includes("No open leads yet"), html);
    assertGradeSix(html, "LeadsBoard empty state");
  });

  it("reads at grade 6 with content", () => {
    assertGradeSix(renderToString(<LeadsBoard leads={[lead]} />), "LeadsBoard");
  });
});

const student: StudentsBoardItem = {
  studentId: "stu-1",
  displayName: "Dana Rivers",
  leads: [
    {
      jobLeadId: "lead-1",
      title: "Production Associate",
      employerName: "Mountain Metal",
      reasons: ["Day shift. You can work then.", "$15 an hour."],
    },
  ],
};

describe("StudentsBoard", () => {
  it("links each student to their record", () => {
    const html = renderToString(<StudentsBoard students={[student]} />);
    assert.ok(html.includes('href="/teacher/students/stu-1"'), html);
  });

  it("shows the reason, never a score", () => {
    const html = renderToString(<StudentsBoard students={[student]} />);
    assert.ok(html.includes("You can work then."), html);
    assert.ok(!html.includes("score"), "a number is not a reason an instructor can act on");
    assert.ok(!/\b\d{1,3}%/u.test(html), html);
  });

  it("says plainly when nothing fits yet, and names the screen to check", () => {
    const html = renderToString(<StudentsBoard students={[{ ...student, leads: [] }]} />);
    assert.ok(html.includes("No lead fits them yet"), html);
    assert.ok(
      html.includes("Work availability"),
      '"check their work answers" did not say WHICH answers or where they live',
    );
    assertGradeSix(html, "StudentsBoard no-fit state");
  });

  it("offers a filter and collapses past ten students", () => {
    const many = Array.from({ length: 13 }, (_, index) => ({
      ...student,
      studentId: `stu-${index}`,
      displayName: `Student ${index}`,
    }));
    const html = renderToString(<StudentsBoard students={many} />);
    assert.ok(html.includes('id="students-filter"'), html);
    assert.ok(stripTags(html).includes("Show 3 more students"), stripTags(html));
  });

  it("reads at grade 6", () => {
    assertGradeSix(renderToString(<StudentsBoard students={[student]} />), "StudentsBoard");
  });
});

const employer: EmployerDirectoryItem = {
  id: "emp-1",
  name: "Mountain Metal",
  city: "Beckley",
  county: "Raleigh",
  status: "active",
  ownerName: "Ms. Legg",
  lastHiredAt: "2026-05-01",
  hiredSpokesGradBefore: true,
  subsidyFlags: { eip: "known", esp: "unknown", ojt: "unknown", wotc: "unknown", bonding: "unknown" },
  openLeadCount: 2,
};

describe("EmployerDirectory", () => {
  it("names the relationship owner and the hire history", () => {
    // React inserts comment separators between text and expressions, so the
    // assertion is on the rendered TEXT, which is what a person reads.
    const text = stripTags(renderToString(<EmployerDirectory employers={[employer]} />));
    assert.ok(text.includes("Owner: Ms. Legg"), text);
    assert.ok(text.includes("Hired one of ours"), text);
  });

  it("shows a subsidy as known, and an unasked one as not asked", () => {
    const known = renderToString(<EmployerDirectory employers={[employer]} />);
    assert.ok(known.includes("Wage help we know about: EIP."), known);

    const unknown = renderToString(
      <EmployerDirectory
        employers={[
          {
            ...employer,
            subsidyFlags: {
              eip: "unknown",
              esp: "unknown",
              ojt: "unknown",
              wotc: "unknown",
              bonding: "unknown",
            },
          },
        ]}
      />,
    );
    assert.ok(unknown.includes("Wage help: not asked yet."), unknown);
  });

  it("never prints a dollar figure for a subsidy", () => {
    // The WV Works rule table is not signed off (plan P0.8). A number here
    // would be quoted to an employer as if the program stood behind it.
    const html = renderToString(<EmployerDirectory employers={[employer]} />);
    assert.ok(!/\$\s?\d/u.test(html), html);
    assert.ok(!/\d+\s?%/u.test(html), html);
  });

  it("spells out do_not_contact rather than showing the raw enum", () => {
    const html = renderToString(
      <EmployerDirectory employers={[{ ...employer, status: "do_not_contact" }]} />,
    );
    assert.ok(html.includes("Do not contact"), html);
    assert.ok(!html.includes("do_not_contact"), html);
  });

  it("offers a filter and collapses past ten employers", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...employer,
      id: `emp-${index}`,
      name: `Employer ${index}`,
    }));
    const html = renderToString(<EmployerDirectory employers={many} />);
    assert.ok(html.includes('id="employers-filter"'), html);
    assert.ok(stripTags(html).includes("Show 2 more employers"), stripTags(html));
  });

  it("says owner 'Not set' rather than leaving it blank", () => {
    const text = stripTags(
      renderToString(<EmployerDirectory employers={[{ ...employer, ownerName: null }]} />),
    );
    assert.ok(text.includes("Owner: Not set"), text);
  });

  it("reads at grade 6", () => {
    assertGradeSix(renderToString(<EmployerDirectory employers={[employer]} />), "EmployerDirectory");
  });
});

describe("the console's audit of who it names", () => {
  // Asserted on the page SOURCE: this is about whether the audit write is
  // awaited, which no rendered output can show. The page names every student
  // on two boards, so each one is a staff read of student data — and a
  // fire-and-forget write is not guaranteed to survive the response being
  // sent, which is the one thing an audit trail may not do.
  const PAGE = readFileSync(
    path.join(process.cwd(), "src/app/(teacher)/teacher/connect/page.tsx"),
    "utf8",
  );

  it("awaits every recordStudentView instead of firing and forgetting", () => {
    assert.ok(
      !/void\s+recordStudentView/u.test(PAGE),
      "a fire-and-forget audit write can be dropped when the response is sent",
    );
    assert.match(PAGE, /await Promise\.allSettled\(/u);
  });

  it("still cannot let a failed audit sample break the page", () => {
    // allSettled, not all, on the call that WRAPS recordStudentView:
    // recordStudentView swallows its own errors, and this is the second layer
    // that keeps a rejected one from taking the page down. The page's other
    // Promise.all — the four parallel data loads — is a different call.
    const at = PAGE.indexOf("recordStudentView({");
    assert.ok(at > -1, "the page no longer audits the students it names");
    const wrapper = PAGE.slice(Math.max(0, at - 300), at);
    assert.ok(wrapper.includes("Promise.allSettled("), wrapper);
  });
});
