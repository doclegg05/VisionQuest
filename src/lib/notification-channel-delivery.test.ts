import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

const phone = "+15551234567";
const payload = { channel: "sms" as const, studentId: "student-1", templateKey: "notification:test", body: "SPOKES: Check your plan. Reply STOP to stop." };
let jobPayload: Record<string, unknown> = payload;
let emailSends = 0;
let emailPref = { enabled: true, destination: "student@example.test" };
let active = true;
let pref = { enabled: true, destination: phone, smsConsentAt: new Date(), smsRevokedAt: null as Date | null };
let sentToday = 0;
let sentTo: string[] = [];
const policyDb = {
  notificationPreference: { findFirst: async ({ where }: { where: { channel: string } }) => where.channel === "email" ? emailPref : pref },
  outboundMessage: { count: async () => sentToday, create: async () => ({ id: "outbound-1" }), update: async () => ({}) },
  $executeRaw: async () => 1,
};
let attempt = 1;
let succeeds = false;
let throws = false;
let deliveryGate: Promise<void> | undefined;
let sends = 0;
const created: Array<{ type: string; payload: string; status: string }> = [];
const updates: Array<{ data: { status: string; error?: string } }> = [];
const logs: unknown[] = [];
mock.module("./db", { namedExports: { prismaAdmin: {
  ...policyDb,
  student: { findUnique: async () => ({ isActive: active }) },
  $transaction: async (fn: (tx: typeof policyDb) => unknown) => fn(policyDb),
  $queryRaw: async () => [{ id: "job-1", type: "notification_channel_delivery", payload: JSON.stringify(jobPayload), attempts: attempt }],
  backgroundJob: {
    create: async ({ data }: { data: { type: string; payload: string; status: string } }) => {
      created.push(data);
      return { id: `queued-${created.length}` };
    },
    update: async (args: { data: { status: string; error?: string } }) => { updates.push(args); return {}; },
  },
} } });
mock.module("./email", { namedExports: { isEmailDeliveryConfigured: () => true, sendEmail: async () => { emailSends++; await deliveryGate; } } });
mock.module("./sms", { namedExports: { sendSms: async (to: string) => {
  sends++;
  sentTo.push(to);
  await deliveryGate;
  if (throws) throw new Error(`${phone} provider failure`);
  return succeeds;
} } });
mock.module("./logger", { namedExports: { logger: {
  error: (...args: unknown[]) => logs.push(args),
  warn: (...args: unknown[]) => logs.push(args),
  info: (...args: unknown[]) => logs.push(args),
} } });
mock.module("./log-keys", { namedExports: { studentLogKey: () => "redacted" } });
let processJobs: typeof import("./jobs").processJobs;
let schedule: typeof import("./notification-channel-delivery").scheduleNotificationChannelDelivery;
before(async () => {
  const jobs = await import("./jobs");
  const { deliverNotificationChannel, scheduleNotificationChannelDelivery } = await import("./notification-channel-delivery");
  schedule = scheduleNotificationChannelDelivery;
  jobs.registerJobHandler("notification_channel_delivery", deliverNotificationChannel);
  processJobs = jobs.processJobs;
});
beforeEach((t) => {
  assert.ok("mock" in t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T16:00:00Z").getTime() });
  active = true; sentToday = 0; sentTo = [];
  jobPayload = payload; emailSends = 0;
  emailPref = { enabled: true, destination: "student@example.test" };
  pref = { enabled: true, destination: phone, smsConsentAt: new Date(), smsRevokedAt: null };
  updates.length = 0; logs.length = 0; created.length = 0;
  attempt = 1; sends = 0; succeeds = false; throws = false; deliveryGate = undefined;
});

test("more than 16 deliveries are all started or inserted as durable pending jobs", async () => {
  let release!: () => void;
  deliveryGate = new Promise<void>((resolve) => { release = resolve; });
  succeeds = true;
  try {
    await Promise.all(Array.from({ length: 40 }, () => schedule({ ...payload, channel: "sms" })));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sends, 16);
    assert.equal(created.length, 24);
    for (const job of created) {
      assert.equal(job.type, "notification_channel_delivery");
      assert.equal(job.status, "pending");
      assert.deepEqual(JSON.parse(job.payload), payload);
    }
    // Enqueueing must not process existing jobs or send overflow inline.
    assert.equal(updates.length, 0);
  } finally { release(); }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 16);
});

for (const policy of ["revoked", "disabled", "unverified", "inactive", "cap", "quiet-hours", "no-phone"] as const) {
  test(`durable SMS rechecks ${policy} after enqueue`, async (t) => {
    let release!: () => void;
    deliveryGate = new Promise<void>((resolve) => { release = resolve; });
    succeeds = true;
    try {
      await Promise.all(Array.from({ length: 17 }, () => schedule(payload)));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(created.length, 1);
      jobPayload = JSON.parse(created[0].payload);
      assert.deepEqual(jobPayload, payload);
    } finally { release(); }
    await new Promise((resolve) => setImmediate(resolve));
    sends = 0;
    if (policy === "revoked") pref.smsRevokedAt = new Date();
    if (policy === "disabled") pref.enabled = false;
    if (policy === "unverified") Object.assign(pref, { smsConsentAt: null });
    if (policy === "inactive") active = false;
    if (policy === "cap") sentToday = 2;
    if (policy === "no-phone") pref.destination = "";
    if (policy === "quiet-hours") t.mock.timers.setTime(new Date("2026-09-02T05:00:00Z").getTime());
    assert.equal(await processJobs(1), 1);
    assert.equal(sends, 0);
    assert.equal(updates[0].data.status, "completed");
  });
}

for (const policy of ["disabled", "inactive", "changed-destination"] as const) {
  test(`durable email rechecks ${policy} after enqueue`, async () => {
    const email = { channel: "email" as const, studentId: "student-1", to: "student@example.test", subject: "Subject", text: "Body" };
    let release!: () => void;
    deliveryGate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await Promise.all(Array.from({ length: 17 }, () => schedule(email)));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(created.length, 1);
      jobPayload = JSON.parse(created[0].payload);
    } finally { release(); }
    await new Promise((resolve) => setImmediate(resolve));
    emailSends = 0;
    if (policy === "disabled") emailPref.enabled = false;
    if (policy === "inactive") active = false;
    if (policy === "changed-destination") emailPref.destination = "new@example.test";
    assert.equal(await processJobs(1), 1);
    assert.equal(emailSends, 0);
  });
}

test("legacy destination-only SMS jobs fail closed", async () => {
  jobPayload = { channel: "sms", to: phone, body: payload.body };
  assert.equal(await processJobs(1), 0);
  assert.equal(sends, 0);
});

test("queued SMS resolves the current consented phone, not a stored destination", async () => {
  succeeds = true;
  pref.destination = "+15557654321";
  assert.equal(await processJobs(1), 1);
  assert.deepEqual(sentTo, [pref.destination]);
});

test("a retry after provider failure honours newly revoked consent", async () => {
  assert.equal(await processJobs(1), 0);
  assert.equal(sends, 1);
  pref.smsRevokedAt = new Date();
  succeeds = true;
  assert.equal(await processJobs(1), 1);
  assert.equal(sends, 1);
});

test("SMS false result remains pending for retry, never marked complete", async () => {
  assert.equal(await processJobs(1), 0);
  assert.equal(updates[0].data.status, "pending");
  assert.equal(updates[0].data.error, "Notification channel delivery failed.");
  succeeds = true;
  attempt = 2;
  assert.equal(await processJobs(1), 1);
  assert.equal(updates[1].data.status, "completed");
});

test("exhausted retries fail visibly with only generic persisted/logged errors", async () => {
  attempt = 3;
  assert.equal(await processJobs(1), 0);
  assert.equal(updates[0].data.status, "failed");
  assert.equal(updates[0].data.error, "Notification channel delivery failed.");
  assert.ok(logs.length >= 1);
  for (const output of [JSON.stringify(logs), JSON.stringify(updates)]) {
    assert.ok(!output.includes(phone));
    assert.ok(!output.includes(payload.body));
  }
});
