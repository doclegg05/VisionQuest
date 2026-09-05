/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

/**
 * The employer response page is the only surface in this program that a
 * stranger can open with no account. Three properties are pinned here:
 *
 *   1. NO STUDENT ID in the rendered HTML — not in a link, not in a prop, not
 *      in a data attribute. Asserted against the real markup, not by reading
 *      the view model, because the leak that matters is the one that reaches
 *      the browser.
 *   2. No score, rank, or comparison (design spec §10).
 *   3. Every dead link renders ONE neutral page, so the page cannot be used to
 *      tell an unknown token from an expired or already-answered one.
 */

const STUDENT_ID = "clstudent00000000000000x";
const CONNECTION_ID = "clconn000000000000000001";

const state = {
  view: null as any,
};

mock.module("@/lib/connect/employer-link", {
  namedExports: {
    resolveEmployerLink: async () => state.view,
    recordEmployerView: async () => undefined,
    EMPLOYER_LINK_INACTIVE_MESSAGE: "This link is no longer active.",
  },
});

mock.module("@/lib/connect/employer-actions", {
  namedExports: {
    listInstructorSlots: async () => [
      { startsAt: "2026-09-10T14:00:00.000Z", endsAt: "2026-09-10T14:30:00.000Z" },
    ],
  },
});

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: async () => "all" },
});

let EmployerConnectPage: any;

before(async () => {
  EmployerConnectPage = (await import("./page")).default;
});

function activeView() {
  return {
    connectionId: CONNECTION_ID,
    status: "sent",
    packet: {
      resumeVersionId: "clresume0000000000000000",
      coverLetterId: null,
      resumeFileUploadId: "clfile0000000000000000001",
      endorsement: "Dana came to every class and earned the forklift card.",
      includedCertIds: [],
      includedFields: [
        "candidate_name",
        "resume",
        "verified_certifications",
        "availability",
        "earliest_start",
        "endorsement",
        "subsidy_line",
      ],
      candidateName: "Dana R.",
      certifications: ["Forklift Operator"],
      availabilitySummary: "Weekdays: mornings, afternoons",
      earliestStart: "2026-09-15",
      subsidyLine: null,
    },
    jobTitle: "Production Associate",
    employerName: "Mountain Metal",
    instructorName: "Ms. Legg",
    advisorId: "clteacher0000000000000x",
    hasPacketPdf: true,
  };
}

async function render(token = "tokentokentokentokentoken") {
  return renderToString(await EmployerConnectPage({ params: Promise.resolve({ token }) }));
}

beforeEach(() => {
  state.view = activeView();
});

describe("/connect/[token] — the public employer page", () => {
  it("renders the packet the student approved", async () => {
    const html = await render();
    assert.ok(html.includes("Dana R."));
    assert.ok(html.includes("Production Associate"));
    assert.ok(html.includes("Mountain Metal"));
    assert.ok(html.includes("Forklift Operator"));
    assert.ok(html.includes("Ms. Legg"));
  });

  it("puts NO student id anywhere in the rendered HTML", async () => {
    const html = await render();
    assert.ok(!html.includes(STUDENT_ID), "a student id reached the employer's browser");
    // The connection id is not a student identifier, but it is an internal id
    // with no business being on a public page either.
    assert.ok(!html.includes(CONNECTION_ID), "a connection id reached the employer's browser");
  });

  it("never shows a full surname — the packet's own abbreviation is what renders", async () => {
    state.view = { ...activeView(), packet: { ...activeView().packet, candidateName: "Dana R." } };
    const html = await render();
    assert.ok(!html.includes("Rivers"));
  });

  it("shows no score, rank, percentage or comparison", async () => {
    const html = await render();
    for (const banned of ["score", "rank", "match %", "best candidate", "top candidate"]) {
      assert.ok(
        !html.toLowerCase().includes(banned),
        `the employer page must never show "${banned}"`,
      );
    }
  });

  it("says to ask about incentives when no subsidy figure is verified", async () => {
    const html = await render();
    assert.ok(html.includes("Ask about hiring incentives."));
    // No dollar figure may appear from an unverified rule.
    assert.ok(!/\$\d/.test(html), "an unverified dollar figure reached the page");
  });

  it("loads no analytics or third-party script", async () => {
    const html = await render();
    for (const banned of ["googletagmanager", "google-analytics", "gtag(", "hotjar", "segment.io"]) {
      assert.ok(!html.includes(banned), `the employer page loaded ${banned}`);
    }
  });

  it("links the PDF through the token, never through a file or student id", async () => {
    const html = await render();
    assert.match(html, /\/api\/connect\/employer\/[A-Za-z0-9_-]+\/packet/);
    assert.ok(!html.includes("clfile0000000000000000001"), "a file id reached the page");
  });

  it("renders ONE neutral page for an unknown, expired, answered or out-of-pilot link", async () => {
    state.view = null;
    const html = await render();
    assert.ok(html.includes("This link is no longer active."));
    // Nothing about a candidate, and no hint about which failure it was.
    assert.ok(!html.includes("Dana"));
    assert.ok(!html.toLowerCase().includes("expired"));
    assert.ok(!html.toLowerCase().includes("already"));
    assert.ok(!html.toLowerCase().includes("not found"));
  });

  it("offers exactly the three answers, and only those", async () => {
    const html = await render();
    assert.ok(html.includes("I want to meet them"));
    assert.ok(html.includes("Not right now"));
    assert.ok(html.includes("I hired them"));
  });
});
