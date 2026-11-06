import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

let StaffInviteRefused: typeof import("@/lib/staff-invites").StaffInviteRefused;
type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
let emailConfigured = true;
let createError: Error | null = null;
const sendCalls: Array<{ to: string; subject: string; text: string; html?: string }> = [];
const createCalls: unknown[][] = [];
const logLines: unknown[][] = [];
const TOKEN = "tok_SECRET_value";

mock.module("@/lib/logger", {
  exports: {
    logger: {
      info: (...a: unknown[]) => logLines.push(a),
      warn: (...a: unknown[]) => logLines.push(a),
      error: (...a: unknown[]) => logLines.push(a),
      debug: (...a: unknown[]) => logLines.push(a),
    },
  },
});
mock.module("@/lib/email", {
  exports: {
    isEmailDeliveryConfigured: () => emailConfigured,
    sendEmail: async (payload: { to: string; subject: string; text: string; html?: string }) => {
      sendCalls.push(payload);
    },
  },
});
mock.module("@/lib/staff-invite-list", {
  exports: {
    listStaffInvites: async () => [{ id: "inv1", email: "a@b.org" }],
    regionNameFor: async () => "North",
  },
});

let POST: typeof import("./route").POST;
let GET: typeof import("./route").GET;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  ({ StaffInviteRefused } = await import("@/lib/staff-invites"));
  const realInvites = await import("@/lib/staff-invites");
  mock.module("@/lib/staff-invites", {
    exports: {
      ...realInvites,
      createStaffInvite: async (...args: unknown[]) => {
        createCalls.push(args);
        if (createError) throw createError;
        return { inviteId: "inv1", token: TOKEN, expiresAt: new Date("2030-01-01T00:00:00Z") };
      },
    },
  });
  ({ POST, GET } = await import("./route"));
});


function post(body: unknown) {
  return POST(mockRequest("/api/staff-invites", { method: "POST", body }));
}
const BODY = { email: "new@example.org", role: "teacher", regionId: "ckxxxxxxxxxxxxxxxxxxxxxxx" };

beforeEach(() => {
  session = { id: "c1", studentId: "coord", displayName: "Coord", role: "coordinator" };
  emailConfigured = true;
  createError = null;
  sendCalls.length = 0;
  createCalls.length = 0;
  logLines.length = 0;
});

describe("POST /api/staff-invites", () => {
  it("answers 401 with no session", async () => {
    session = null;
    assert.equal((await post(BODY)).status, 401);
  });

  it("refuses a teacher with 403", async () => {
    session = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };
    const res = await post(BODY);
    assert.equal(res.status, 403);
    assert.equal(createCalls.length, 0);
  });

  it("maps a region refusal to a plain 403", async () => {
    createError = new StaffInviteRefused("region_not_allowed");
    const res = await post(BODY);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You can invite people only to your own region." });
  });

  it("emails the link and hides it from the response when email is configured", async () => {
    const res = await post(BODY);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.emailed, true);
    assert.equal("link" in json.data, false);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].to, "new@example.org");
    assert.ok(sendCalls[0].text.includes(`/invite/${TOKEN}`));
  });

  it("returns the link and sends nothing when email is not configured", async () => {
    emailConfigured = false;
    const json = await (await post(BODY)).json();
    assert.equal(json.data.emailed, false);
    assert.ok(String(json.data.link).endsWith(`/invite/${TOKEN}`));
    assert.equal(sendCalls.length, 0);
  });

  it("never logs the token or the link", async () => {
    emailConfigured = false;
    await post(BODY);
    assert.equal(JSON.stringify(logLines).includes(TOKEN), false);
  });

  it("rejects a bad body with 400", async () => {
    assert.equal((await post({ email: "nope", role: "teacher" })).status, 400);
  });
});

describe("GET /api/staff-invites", () => {
  it("refuses a teacher with 403", async () => {
    session = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };
    assert.equal((await GET()).status, 403);
  });

  it("lists invites for a coordinator in the envelope", async () => {
    const json = await (await GET()).json();
    assert.equal(json.success, true);
    assert.equal(json.data.invites.length, 1);
  });
});
