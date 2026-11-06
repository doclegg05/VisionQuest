import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { createFakeDb } from "@/lib/staff-invite-test-db";
import { mockRequest } from "@/lib/test-helpers";

// The invite modules run for real over the in-memory database. Only the
// database, email, the session and the logger (a spy) are stand-ins.

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
let emailConfigured = true;
let sendThrows = false;
const sendCalls: Array<{ to: string; subject: string; text: string; html?: string }> = [];
const logLines: unknown[][] = [];
const fake = createFakeDb();

const REGION_A = "cmregionaaaaaaaaaaaaaaaaa";
const REGION_B = "cmregionbbbbbbbbbbbbbbbbb";

mock.module("@/lib/db", { exports: { prisma: fake.client, prismaAdmin: fake.client } });
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
      if (sendThrows) throw new Error("SMTP connection refused");
      sendCalls.push(payload);
    },
  },
});

let POST: typeof import("./route").POST;
let GET: typeof import("./route").GET;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  ({ POST, GET } = await import("./route"));
});

function post(body: unknown) {
  return POST(mockRequest("/api/staff-invites", { method: "POST", body }));
}
const BODY = { email: "new@example.org", role: "teacher", regionId: REGION_A };
const COORDINATOR: TestSession = { id: "c1", studentId: "coord", displayName: "Coord", role: "coordinator" };
const ADMIN: TestSession = { id: "a1", studentId: "admin", displayName: "Admin", role: "admin" };

beforeEach(() => {
  process.env.APP_BASE_URL = "https://visionquest.example";
  fake.reset();
  fake.seed("region", { id: REGION_A, name: "North", status: "active" });
  fake.seed("region", { id: REGION_B, name: "South", status: "active" });
  fake.seed("regionCoordinator", { regionId: REGION_A, coordinatorId: COORDINATOR.id });
  session = COORDINATOR;
  emailConfigured = true;
  sendThrows = false;
  sendCalls.length = 0;
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
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("maps a region refusal to a plain 403", async () => {
    const res = await post({ ...BODY, regionId: REGION_B });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You can invite people only to your own region." });
  });

  it("emails the link and hides it from the response when email is configured", async () => {
    const res = await post(BODY);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.emailed, true);
    assert.equal(json.data.delivery, "sent");
    assert.equal("link" in json.data, false);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].to, "new@example.org");
    assert.match(sendCalls[0].text, /\/invite\/[A-Za-z0-9_-]{43}/);
    assert.ok(sendCalls[0].text.includes("North"));
  });

  it("refuses a coordinator with 503 email_required, and creates nothing, when email is not set up", async () => {
    emailConfigured = false;
    const res = await post(BODY);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {
      error: "Email is not working right now, so only an admin can send this invite.",
    });
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("refuses a coordinator the same way, and creates nothing, when the send throws", async () => {
    sendThrows = true;
    const res = await post(BODY);
    assert.equal(res.status, 503);
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("builds the link from APP_BASE_URL, never from the request's host", async () => {
    session = ADMIN;
    emailConfigured = false;
    const json = await (await post(BODY)).json();
    assert.match(String(json.data.link), /^https:\/\/visionquest\.example\/invite\//);
  });

  it("refuses with 500 and creates nothing when APP_BASE_URL is not set", async () => {
    delete process.env.APP_BASE_URL;
    session = ADMIN;
    emailConfigured = false;
    const res = await post(BODY);
    assert.equal(res.status, 500);
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("returns the link to an admin and sends nothing when email is not configured", async () => {
    session = ADMIN;
    emailConfigured = false;
    const json = await (await post(BODY)).json();
    assert.equal(json.data.emailed, false);
    assert.equal(json.data.delivery, "not_configured");
    assert.match(String(json.data.link), /\/invite\/[A-Za-z0-9_-]{43}$/);
    assert.equal(sendCalls.length, 0);
  });

  it("tells an admin the send failed, and returns the link, when the send throws", async () => {
    session = ADMIN;
    sendThrows = true;
    const json = await (await post(BODY)).json();
    assert.equal(json.data.emailed, false);
    assert.equal(json.data.delivery, "failed");
    assert.ok(json.data.link);
  });

  it("never logs the token or the link", async () => {
    session = ADMIN;
    sendThrows = true;
    const json = await (await post(BODY)).json();
    const token = String(json.data.link).split("/").at(-1) ?? "";
    assert.ok(token.length > 0);
    assert.ok(logLines.length > 0, "the failed send was logged");
    assert.equal(JSON.stringify(logLines).includes(token), false);
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

  it("lists a coordinator's own invites in the envelope", async () => {
    await post(BODY);
    const json = await (await GET()).json();
    assert.equal(json.success, true);
    assert.equal(json.data.invites.length, 1);
  });
});
