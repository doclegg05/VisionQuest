/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

/** Public credential privacy, crawler policy, and minimal evidence payload. */
const LOGIN_ID = "zqx.login.sentinel";
const STUDENT_CUID = "clzstudent00000000000042";
const state = { page: null as any };
const mockFindUnique = mock.fn(async () => state.page) as any;

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { publicCredentialPage: { findUnique: mockFindUnique } } },
});
mock.module("next/navigation", {
  namedExports: { notFound: () => { throw new Error("NOT_FOUND"); } },
});
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
      _count: { portfolioItems: 123 },
      certifications: [{
        status: "completed",
        completedAt: new Date("2026-08-01T00:00:00.000Z"),
        requirements: [
          { id: "r1", completed: true, verifiedBy: "t1" },
          { id: "r2", completed: true, verifiedBy: "t1" },
        ],
      }],
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
    assert.match(html, /2(<!-- -->)?\/(<!-- -->)?2/);
  });
  it("puts NO login username anywhere in the rendered HTML", async () => {
    const html = await render();
    assert.ok(!html.includes(LOGIN_ID));
    assert.ok(!/Student ID/i.test(html));
  });
  it("puts no student cuid or email in the rendered HTML either", async () => {
    // Return private fields regardless of select to catch rendering regressions.
    const html = await render();
    assert.ok(!html.includes(STUDENT_CUID));
    assert.ok(!html.includes("tanesha.zqx@example.org"));
  });
  it("tells crawlers not to index or follow", () => {
    assert.deepEqual(credentialsMetadata?.robots, { index: false, follow: false });
  });
  it("reads the Ready-to-Work family, including family-member certifications", async () => {
    await render();
    assert.equal(mockFindUnique.mock.callCount(), 1);
    const args = mockFindUnique.mock.calls[0].arguments[0];
    assert.deepEqual(args.include.student.select.certifications.where.certType.in, [...READY_TO_WORK_FAMILY_CERT_TYPES]);
  });
  it("counts evidence without loading portfolio IDs or student login fields", async () => {
    assert.ok((await render()).includes(">123<"));
    assert.deepEqual(mockFindUnique.mock.calls[0].arguments[0], {
      where: { slug: "tanesha-rivers" },
      include: {
        student: { select: {
          displayName: true,
          _count: { select: { portfolioItems: true } },
          certifications: {
            where: { certType: { in: [...READY_TO_WORK_FAMILY_CERT_TYPES] } },
            select: {
              status: true, completedAt: true,
              requirements: { select: { id: true, completed: true, verifiedBy: true } },
            },
          },
        } },
      },
    });
  });
  it("does not render missing or private pages", async () => {
    state.page = null;
    await assert.rejects(render, /NOT_FOUND/);
    state.page = publishedPage();
    state.page.isPublic = false;
    await assert.rejects(render, /NOT_FOUND/);
  });
  it("does not render missing or incomplete certifications", async () => {
    state.page.student.certifications = [];
    await assert.rejects(render, /NOT_FOUND/);
    state.page = publishedPage();
    state.page.student.certifications[0].status = "in_progress";
    await assert.rejects(render, /NOT_FOUND/);
  });
});

describe("/connect/[token] — robots metadata", () => {
  it("tells crawlers not to index or follow", () => {
    assert.deepEqual(connectMetadata?.robots, { index: false, follow: false });
  });
});
