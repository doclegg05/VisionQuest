/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

/**
 * FERPA review W7 (2026-09-06). The public credential page is one of two
 * surfaces a stranger can open with no account (the other is /connect/[token]).
 * It printed the student's LOGIN USERNAME under their name, on a page with no
 * `noindex` and a repo with no robots.txt — so a search engine could index a
 * TANF recipient's name next to the credential they sign in with.
 *
 * Pinned here, against the rendered HTML:
 *   1. NO login username in the markup (the review's F12 first instance).
 *   2. Both public pages export `robots: { index: false, follow: false }`.
 */

const LOGIN_ID = "zqx.login.sentinel";
const STUDENT_CUID = "clzstudent00000000000042";

const state = {
  page: null as any,
};

const mockFindUnique = mock.fn(async () => state.page) as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      publicCredentialPage: { findUnique: mockFindUnique },
    },
  },
});

// /connect/[token]'s own dependencies, mocked the way its page test does, so
// its `metadata` export can be read here without a database.
mock.module("@/lib/connect/employer-link", {
  namedExports: {
    resolveEmployerLink: async () => null,
    recordEmployerView: async () => undefined,
    EMPLOYER_LINK_INACTIVE_MESSAGE: "This link is no longer active.",
  },
});
mock.module("@/lib/connect/employer-actions", {
  namedExports: { listInstructorSlots: async () => [] },
});
mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: async () => "all" },
});

let PublicCredentialPage: any;
let credentialsMetadata: any;
let connectMetadata: any;

before(async () => {
  const credentials = await import("./page");
  PublicCredentialPage = credentials.default;
  credentialsMetadata = credentials.metadata;
  const connect = await import("../../connect/[token]/page");
  connectMetadata = connect.metadata;
});

function publishedPage() {
  return {
    slug: "tanesha-rivers",
    isPublic: true,
    headline: null,
    summary: null,
    student: {
      id: STUDENT_CUID,
      displayName: "Tanesha Rivers",
      studentId: LOGIN_ID,
      email: "tanesha.zqx@example.org",
      portfolioItems: [{ id: "p1" }, { id: "p2" }],
      certifications: [
        {
          status: "completed",
          completedAt: new Date("2026-08-01T00:00:00.000Z"),
          requirements: [
            { id: "r1", completed: true, verifiedBy: "t1" },
            { id: "r2", completed: true, verifiedBy: "t1" },
          ],
        },
      ],
    },
  };
}

async function render(slug = "tanesha-rivers") {
  return renderToString(await PublicCredentialPage({ params: Promise.resolve({ slug }) }));
}

beforeEach(() => {
  state.page = publishedPage();
  mockFindUnique.mock.resetCalls();
});

describe("/credentials/[slug] — the public credential page", () => {
  it("renders the learner's name and the credential", async () => {
    const html = await render();
    assert.ok(html.includes("Tanesha Rivers"));
    assert.ok(html.includes("Ready to Work"));
    // renderToString interleaves comment nodes between adjacent expressions.
    assert.match(html, /2(<!-- -->)?\/(<!-- -->)?2/);
  });

  it("puts NO login username anywhere in the rendered HTML", async () => {
    const html = await render();
    assert.ok(!html.includes(LOGIN_ID), "the login username reached the public page");
    assert.ok(!/Student ID/i.test(html), "a 'Student ID' label is still rendered");
  });

  it("puts no student cuid or email in the rendered HTML either", async () => {
    // The mock returns the full row regardless of `select`, so a future
    // widening of the query cannot hide behind the projection.
    const html = await render();
    assert.ok(!html.includes(STUDENT_CUID));
    assert.ok(!html.includes("tanesha.zqx@example.org"));
  });

  it("tells crawlers not to index or follow", () => {
    assert.deepEqual(credentialsMetadata?.robots, { index: false, follow: false });
  });

  it("reads the Ready-to-Work family, not an exact 'ready-to-work' match, so a family-member certification (D7) still publishes here", async () => {
    await render();

    assert.equal(mockFindUnique.mock.callCount(), 1);
    const args = mockFindUnique.mock.calls[0].arguments[0] as any;
    const certWhere = args.include.student.select.certifications.where;
    assert.deepEqual(certWhere.certType.in, [...READY_TO_WORK_FAMILY_CERT_TYPES]);
  });
});

describe("/connect/[token] — robots metadata", () => {
  it("tells crawlers not to index or follow", () => {
    assert.deepEqual(connectMetadata?.robots, { index: false, follow: false });
  });
});
