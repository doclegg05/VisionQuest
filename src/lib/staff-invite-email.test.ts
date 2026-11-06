import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { createFakeDb, type Row } from "@/lib/staff-invite-test-db";

// Ruling R21: an emailed invite needs a 6-digit code, emailed to the invite's
// address, before it can be accepted. Only `@/lib/db` and `@/lib/email` are
// mocked; org-roles, region and the invite modules run for real.

const fake = createFakeDb();
mock.module("@/lib/db", { exports: { prisma: fake.client, prismaAdmin: fake.client } });

interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
const sent: SentEmail[] = [];
let emailConfigured = true;
let sendThrows = false;
mock.module("@/lib/email", {
  exports: {
    isEmailDeliveryConfigured: () => emailConfigured,
    sendEmail: async (payload: SentEmail) => {
      if (sendThrows) throw new Error("SMTP connection refused");
      sent.push(payload);
    },
  },
});

let invites: typeof import("./staff-invites");
let delivery: typeof import("./staff-invite-email");

before(async () => {
  invites = await import("./staff-invites");
  delivery = await import("./staff-invite-email");
});

const admin: Session = { id: "admin-1", studentId: "admin", displayName: "Admin", role: "admin" };
const coordinator: Session = { id: "coord-1", studentId: "coord", displayName: "Coord", role: "coordinator" };
const programCoordinator: Session = { id: "pc-1", studentId: "pc", displayName: "PC", role: "program_coordinator" };
const REGION_A = "cmregionaaaaaaaaaaaaaaaaa";
const PASSWORD = "a long enough password";
const linkFor = (token: string) => `https://vq.example/invite/${token}`;

beforeEach(() => {
  fake.reset();
  sent.length = 0;
  emailConfigured = true;
  sendThrows = false;
  fake.seed("region", { id: REGION_A, name: "North", status: "active" });
  fake.seed("regionCoordinator", { regionId: REGION_A, coordinatorId: coordinator.id });
  for (const inviter of [admin, coordinator, programCoordinator]) {
    fake.seed("student", { id: inviter.id, studentId: inviter.studentId, email: null, role: inviter.role, isActive: true });
  }
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof invites.StaffInviteRefused, `expected StaffInviteRefused, got ${String(error)}`);
    return error.reason;
  }
  assert.fail("expected a refusal");
}

function inviteRow(inviteId: string): Row {
  const row = fake.state.staffInvite.rows.find((r) => r.id === inviteId);
  assert.ok(row, `invite ${inviteId} exists`);
  return row;
}

function accountRows(): Row[] {
  const inviters = new Set([admin.id, coordinator.id, programCoordinator.id]);
  return fake.state.student.rows.filter((r) => !inviters.has(String(r.id)));
}

/** A coordinator's emailed teacher invite, with the token read back out of the email. */
async function emailedInvite(): Promise<{ inviteId: string; token: string }> {
  const result = await delivery.sendStaffInvite(coordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor);
  const link = sent.at(-1)?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(link, "the invite email carries the link");
  return { inviteId: result.inviteId, token: link };
}

/** Request a code and read it out of the email. */
async function requestCode(token: string): Promise<string> {
  const before = sent.length;
  await delivery.requestStaffInviteCode(token);
  assert.equal(sent.length, before + 1, "a code email was sent");
  const code = sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, "the code email carries a 6-digit code");
  return code;
}

function accept(token: string, code?: string) {
  return invites.acceptStaffInvite({ token, email: "pat@example.org", displayName: "Pat Doe", password: PASSWORD, code });
}

function wrongCodeFor(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

describe("sendStaffInvite", () => {
  it("emails the link and marks the invite deliveredByEmail", async () => {
    const result = await delivery.sendStaffInvite(coordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    assert.equal(result.delivery, "sent");
    assert.equal(result.link, null);
    assert.equal(inviteRow(result.inviteId).deliveredByEmail, true);
    assert.equal(sent[0].to, "pat@example.org");
  });

  it("refuses a coordinator with email_required, and creates nothing, when email is not set up", async () => {
    emailConfigured = false;
    const reason = await refusal(
      delivery.sendStaffInvite(coordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor),
    );
    assert.equal(reason, "email_required");
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("refuses a coordinator with email_required, and creates nothing, when the send throws", async () => {
    sendThrows = true;
    const reason = await refusal(
      delivery.sendStaffInvite(coordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor),
    );
    assert.equal(reason, "email_required");
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("refuses a program coordinator the same way", async () => {
    emailConfigured = false;
    const reason = await refusal(
      delivery.sendStaffInvite(programCoordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor),
    );
    assert.equal(reason, "email_required");
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("still checks the inviter's authority before the email rule", async () => {
    emailConfigured = false;
    const reason = await refusal(
      delivery.sendStaffInvite(coordinator, { email: "pat@example.org", role: "coordinator", regionId: REGION_A }, linkFor),
    );
    assert.equal(reason, "not_allowed");
  });

  it("gives an admin a link-only invite when email is not set up", async () => {
    emailConfigured = false;
    const result = await delivery.sendStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    assert.equal(result.delivery, "not_configured");
    assert.match(String(result.link), /^https:\/\/vq\.example\/invite\//);
    assert.equal(inviteRow(result.inviteId).deliveredByEmail, false);
  });

  it("tells an admin the send failed, and gives a link-only invite, when the send throws", async () => {
    sendThrows = true;
    const result = await delivery.sendStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    assert.equal(result.delivery, "failed");
    assert.ok(result.link);
    assert.equal(inviteRow(result.inviteId).deliveredByEmail, false);
  });
});

describe("requestStaffInviteCode", () => {
  it("stores only the SHA-256 of a 6-digit code, for 10 minutes, and emails it to the invite's address", async () => {
    const { inviteId, token } = await emailedInvite();
    fake.patch("staffInvite", inviteId, { codeAttempts: 3 });
    const startedAt = Date.now();
    const code = await requestCode(token);

    const row = inviteRow(inviteId);
    assert.match(code, /^\d{6}$/);
    assert.equal(sent.at(-1)?.to, "pat@example.org");
    assert.equal(row.codeHash, createHash("sha256").update(`${inviteId}:${code}`).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(`"${code}"`), "the plain code is never stored");
    assert.equal(row.codeAttempts, 0);
    const expiresAt = (row.codeExpiresAt as Date).getTime();
    assert.ok(expiresAt >= startedAt + 10 * 60_000 && expiresAt <= Date.now() + 10 * 60_000);
  });

  it("does nothing, and does not throw, for an unknown token", async () => {
    await delivery.requestStaffInviteCode("not-a-real-token");
    assert.equal(sent.length, 0);
  });

  it("sends no code for a link-only invite, a used one, a revoked one or an expired one", async () => {
    emailConfigured = false;
    const linkOnly = await delivery.sendStaffInvite(admin, { email: "a@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    emailConfigured = true;
    await delivery.requestStaffInviteCode(String(linkOnly.link).split("/").at(-1) ?? "");

    const { inviteId, token } = await emailedInvite();
    const afterInvite = sent.length;
    for (const patch of [{ acceptedAt: new Date() }, { revokedAt: new Date() }, { expiresAt: new Date(Date.now() - 1000) }]) {
      fake.patch("staffInvite", inviteId, { acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), ...patch });
      await delivery.requestStaffInviteCode(token);
    }
    assert.equal(sent.length, afterInvite);
    assert.equal(inviteRow(inviteId).codeHash, null);
  });

  it("does not throw when the code email fails to send", async () => {
    const { token } = await emailedInvite();
    sendThrows = true;
    await delivery.requestStaffInviteCode(token);
  });
});

describe("acceptStaffInvite with a code", () => {
  it("accepts an emailed invite with the right code and clears the code", async () => {
    const { inviteId, token } = await emailedInvite();
    const code = await requestCode(token);
    await accept(token, code);
    assert.equal(accountRows().length, 1);
    assert.equal(inviteRow(inviteId).codeHash, null);
  });

  it("refuses an emailed invite with no code as code_required", async () => {
    const { token } = await emailedInvite();
    await requestCode(token);
    assert.equal(await refusal(accept(token)), "code_required");
    assert.equal(accountRows().length, 0);
  });

  it("refuses an emailed invite before any code was sent as code_expired", async () => {
    const { token } = await emailedInvite();
    assert.equal(await refusal(accept(token, "123456")), "code_expired");
  });

  it("counts a wrong code, keeps the count, and leaves the invite unaccepted", async () => {
    const { inviteId, token } = await emailedInvite();
    const code = await requestCode(token);
    assert.equal(await refusal(accept(token, wrongCodeFor(code))), "code_invalid");
    assert.equal(inviteRow(inviteId).codeAttempts, 1);
    assert.equal(inviteRow(inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 0);
    await accept(token, code);
    assert.equal(accountRows().length, 1);
  });

  it("clears the code after 5 wrong tries, then refuses even the right code until a new one is sent", async () => {
    const { inviteId, token } = await emailedInvite();
    const code = await requestCode(token);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal(await refusal(accept(token, wrongCodeFor(code))), "code_invalid", `attempt ${attempt}`);
    }
    assert.equal(inviteRow(inviteId).codeHash, null);
    assert.equal(await refusal(accept(token, code)), "code_expired");
    assert.equal(accountRows().length, 0);

    const fresh = await requestCode(token);
    await accept(token, fresh);
    assert.equal(accountRows().length, 1);
  });

  it("refuses a code after its 10 minutes as code_expired", async () => {
    const { inviteId, token } = await emailedInvite();
    const code = await requestCode(token);
    fake.patch("staffInvite", inviteId, { codeExpiresAt: new Date(Date.now() - 1000) });
    assert.equal(await refusal(accept(token, code)), "code_expired");
    assert.equal(accountRows().length, 0);
  });

  it("makes one account from two concurrent accepts with the same valid code", async () => {
    const { token } = await emailedInvite();
    const code = await requestCode(token);
    const results = await Promise.allSettled([accept(token, code), accept(token, code)]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof invites.StaffInviteRefused);
    assert.equal(accountRows().length, 1);
    assert.equal(fake.state.regionInstructor.rows.length, 1);
  });

  it("accepts an admin's link-only invite with no code", async () => {
    emailConfigured = false;
    const result = await delivery.sendStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    const token = String(result.link).split("/").at(-1) ?? "";
    await accept(token);
    assert.equal(accountRows().length, 1);
  });
});

describe("previewStaffInvite", () => {
  it("tells the accept page whether the invite needs an email code", async () => {
    const { previewStaffInvite } = await import("./staff-invite-list");
    const { token } = await emailedInvite();
    assert.equal((await previewStaffInvite(token))?.needsCode, true);

    emailConfigured = false;
    const linkOnly = await delivery.sendStaffInvite(admin, { email: "b@example.org", role: "teacher", regionId: REGION_A }, linkFor);
    assert.equal((await previewStaffInvite(String(linkOnly.link).split("/").at(-1) ?? ""))?.needsCode, false);
  });
});
