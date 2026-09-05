/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * `resolveEmployerLink` is the whole authorization story for a stranger.
 * Everything it refuses returns null, and the page turns every null into the
 * same neutral sentence — so these cases are about what must NOT resolve.
 */

const PACKET = {
  resumeVersionId: null,
  coverLetterId: null,
  resumeFileUploadId: null,
  endorsement: "",
  includedCertIds: [],
  includedFields: ["candidate_name", "subsidy_line"],
  candidateName: "Dana R.",
  certifications: [],
  availabilitySummary: "Not set",
  earliestStart: null,
  subsidyLine: null,
};

const state = {
  row: null as any,
  events: [] as any[],
};

const mockFindUnique = mock.fn(async () => state.row) as any;
const mockEventFindFirst = mock.fn(async () => null) as any;
const mockEventCreate = mock.fn(async (args: any) => {
  state.events.push(args.data);
  return { id: "ev-1" };
}) as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      connection: {
        get findUnique() {
          return mockFindUnique;
        },
      },
      connectionEvent: {
        get findFirst() {
          return mockEventFindFirst;
        },
        get create() {
          return mockEventCreate;
        },
      },
    },
    prisma: {},
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } },
});

let resolveEmployerLink: typeof import("./employer-link").resolveEmployerLink;
let mintEmployerToken: typeof import("./employer-link").mintEmployerToken;
let hashEmployerToken: typeof import("./employer-link").hashEmployerToken;
let normalizeEmployerToken: typeof import("./employer-link").normalizeEmployerToken;
let recordEmployerView: typeof import("./employer-link").recordEmployerView;

before(async () => {
  const mod = await import("./employer-link");
  resolveEmployerLink = mod.resolveEmployerLink;
  mintEmployerToken = mod.mintEmployerToken;
  hashEmployerToken = mod.hashEmployerToken;
  normalizeEmployerToken = mod.normalizeEmployerToken;
  recordEmployerView = mod.recordEmployerView;
});

const FUTURE = new Date("2030-01-01T00:00:00.000Z");
const NOW = new Date("2026-09-05T00:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    status: "sent",
    packet: PACKET,
    tokenExpiresAt: FUTURE,
    sentById: "teacher-1",
    jobLead: { title: "Production Associate", classId: "class-a" },
    employer: { name: "Mountain Metal" },
    sentBy: { id: "teacher-1", displayName: "Ms. Legg" },
    ...overrides,
  };
}

const TOKEN = "a".repeat(43);

beforeEach(() => {
  state.row = row();
  state.events.length = 0;
  mockEventFindFirst.mock.resetCalls();
  mockEventCreate.mock.resetCalls();
});

describe("employer tokens", () => {
  it("mints 32 random bytes and stores only the digest", () => {
    const minted = mintEmployerToken(NOW);
    assert.ok(minted.token.length >= 43, "a 32-byte base64url token is 43 characters");
    assert.equal(minted.tokenHash, hashEmployerToken(minted.token));
    assert.notEqual(minted.tokenHash, minted.token);
    // 14 days.
    assert.equal(minted.expiresAt.getTime() - NOW.getTime(), 14 * 24 * 60 * 60 * 1000);
  });

  it("mints a different token every time", () => {
    const a = mintEmployerToken(NOW);
    const b = mintEmployerToken(NOW);
    assert.notEqual(a.token, b.token);
  });

  it("rejects anything that is not shaped like a token before any query", () => {
    for (const bad of ["", "  ", "short", "a".repeat(500), "has spaces here", "a/b", "a+b=="]) {
      assert.equal(normalizeEmployerToken(bad), null, JSON.stringify(bad));
    }
    assert.equal(normalizeEmployerToken(TOKEN), TOKEN);
  });
});

describe("resolveEmployerLink — what must never resolve", () => {
  it("resolves an active link and returns no student id", async () => {
    const view = await resolveEmployerLink(TOKEN, "all", NOW);
    assert.ok(view);
    assert.equal(view.jobTitle, "Production Associate");
    assert.ok(!Object.keys(view).includes("studentId"));
    assert.ok(!JSON.stringify(view).includes("studentId"));
  });

  it("refuses an EXPIRED token", async () => {
    state.row = row({ tokenExpiresAt: new Date("2026-09-01T00:00:00.000Z") });
    assert.equal(await resolveEmployerLink(TOKEN, "all", NOW), null);
  });

  it("refuses a token with no expiry at all", async () => {
    state.row = row({ tokenExpiresAt: null });
    assert.equal(await resolveEmployerLink(TOKEN, "all", NOW), null);
  });

  it("refuses an unknown token", async () => {
    state.row = null;
    assert.equal(await resolveEmployerLink(TOKEN, "all", NOW), null);
  });

  for (const status of ["hired", "not_now", "withdrawn", "closed", "proposed", "student_approved"]) {
    it(`refuses a REPLAY after "${status}"`, async () => {
      state.row = row({ status });
      assert.equal(
        await resolveEmployerLink(TOKEN, "all", NOW),
        null,
        `a "${status}" connection must not render the packet again`,
      );
    });
  }

  it("refuses when the Connect pilot is off", async () => {
    assert.equal(await resolveEmployerLink(TOKEN, null, NOW), null);
    assert.equal(await resolveEmployerLink(TOKEN, "", NOW), null);
  });

  it("refuses a lead in a class outside the pilot", async () => {
    assert.equal(await resolveEmployerLink(TOKEN, "class-b", NOW), null);
    assert.ok(await resolveEmployerLink(TOKEN, "class-a,class-b", NOW));
  });

  it("refuses a program-wide lead unless the pilot is 'all'", async () => {
    state.row = row({ jobLead: { title: "Anywhere", classId: null } });
    assert.equal(await resolveEmployerLink(TOKEN, "class-a", NOW), null);
    assert.ok(await resolveEmployerLink(TOKEN, "all", NOW));
  });

  it("refuses a row whose packet is missing or malformed", async () => {
    state.row = row({ packet: null });
    assert.equal(await resolveEmployerLink(TOKEN, "all", NOW), null);
    state.row = row({ packet: { nonsense: true } });
    assert.equal(await resolveEmployerLink(TOKEN, "all", NOW), null);
  });
});

describe("recordEmployerView", () => {
  it("writes at most one view event per token per hour", async () => {
    mockEventFindFirst.mock.mockImplementationOnce(async () => ({ id: "recent" }));
    await recordEmployerView("conn-1", "viewed", NOW);
    assert.equal(state.events.length, 0, "a recent view must not be recorded again");

    await recordEmployerView("conn-1", "viewed", NOW);
    assert.equal(state.events.length, 1);
  });

  it("never throws — the employer's page must render even if the event fails", async () => {
    mockEventFindFirst.mock.mockImplementationOnce(async () => {
      throw new Error("database gone");
    });
    await recordEmployerView("conn-1", "viewed", NOW);
  });
});
