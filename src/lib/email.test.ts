// =============================================================================
// The email sink, and the one place it must never work.
//
// `EMAIL_SINK_DIR` diverts outgoing mail to a file so a browser test can read
// what was sent — the employer's response token exists in exactly one place,
// the email, and is stored only as a hash, so nothing else can recover it.
//
// The severe failure is the sink being active where real mail matters: every
// crisis notification, password reset and employer packet would appear to send
// and reach nobody, with no error anywhere. That is what the production guard
// is for, and it is what these cases mostly exist to pin.
// =============================================================================

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { isEmailDeliveryConfigured, isEmailSinkActive, sendEmail } from "./email";

const saved = {
  sink: process.env.EMAIL_SINK_DIR,
  nodeEnv: process.env.NODE_ENV,
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  from: process.env.SMTP_FROM,
  hermetic: process.env.EMAIL_SINK_ALLOW_HERMETIC,
  databaseUrl: process.env.DATABASE_URL,
};

/**
 * Indexed by a string variable, because Next's types mark `NODE_ENV` read-only
 * — the same workaround `rate-limit-switch.test.ts` uses.
 */
function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restore(key: keyof typeof saved, envKey: string) {
  setEnv(envKey, saved[key]);
}

afterEach(() => {
  restore("sink", "EMAIL_SINK_DIR");
  restore("nodeEnv", "NODE_ENV");
  restore("host", "SMTP_HOST");
  restore("port", "SMTP_PORT");
  restore("from", "SMTP_FROM");
  restore("hermetic", "EMAIL_SINK_ALLOW_HERMETIC");
  restore("databaseUrl", "DATABASE_URL");
});

describe("the email sink", () => {
  it("writes one JSON line per message instead of sending", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-sink-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "test");

      await sendEmail({ to: "hiring@example.invalid", subject: "One", text: "first" });
      await sendEmail({ to: "hiring@example.invalid", subject: "Two", text: "second" });

      const lines = readFileSync(path.join(dir, "outbox.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      assert.equal(lines.length, 2);
      assert.equal(lines[0].subject, "One");
      assert.equal(lines[1].text, "second");
      // The timestamp is what lets a reader tell a fresh send from a leftover
      // line when a spec runs twice against the same directory.
      assert.ok(Date.parse(lines[0].sentAt) > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts as configured delivery, with no SMTP settings at all", () => {
    // `sendConnection` checks `isEmailDeliveryConfigured` BEFORE it spends one
    // of an employer's three weekly packets. Under a sink the send genuinely
    // will not fail, so answering "not configured" would make the whole send
    // path untestable in a browser.
    process.env.EMAIL_SINK_DIR = "/tmp/whatever";
    setEnv("NODE_ENV", "test");
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;

    assert.equal(isEmailSinkActive(), true);
    assert.equal(isEmailDeliveryConfigured(), true);
  });

  it("is INERT in production, whatever the directory says", () => {
    // The one case that matters. A file sink in production is a silent mail
    // black hole across crisis notifications, password resets and employer
    // packets — so the guard is on NODE_ENV rather than on a flag somebody has
    // to remember to set correctly.
    process.env.EMAIL_SINK_DIR = "/tmp/whatever";
    setEnv("NODE_ENV", "production");
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;

    assert.equal(isEmailSinkActive(), false);
    assert.equal(isEmailDeliveryConfigured(), false);
  });

  it("leaves real SMTP alone when no sink is set", () => {
    delete process.env.EMAIL_SINK_DIR;
    setEnv("NODE_ENV", "test");
    process.env.SMTP_HOST = "smtp.example.invalid";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM = "spokes@example.invalid";

    assert.equal(isEmailSinkActive(), false);
    assert.equal(isEmailDeliveryConfigured(), true);
  });

  it("still refuses to send when nothing at all is configured", async () => {
    delete process.env.EMAIL_SINK_DIR;
    setEnv("NODE_ENV", "test");
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;

    assert.equal(isEmailDeliveryConfigured(), false);
    await assert.rejects(
      () => sendEmail({ to: "a@example.invalid", subject: "s", text: "t" }),
      /not configured/i,
    );
  });
});

// =============================================================================
// The production refusal, and the one hole deliberately left in it.
//
// A file sink on a real deployment is a silent mail black hole — crisis
// notifications, password resets, employer packets, all appearing to send and
// reaching nobody. It stays refused. What CI needs is narrower than "allow it
// in production": the e2e job runs the BUILT server, which hard-sets
// NODE_ENV=production, against a hermetic throwaway database.
//
// So the hole is shaped like the rig and not like a deployment: an explicit
// opt-in AND a database that `isSafeE2eSeedTarget` — the same guard that
// gates the committed-password seed — recognises as local or CI. Every case
// below that flips one of those to a production-shaped value must refuse.
// =============================================================================

const HERMETIC_DB = "postgresql://postgres:postgres@localhost:5432/visionquest_e2e";
const PRODUCTION_DB = "postgresql://user:pw@db.abcdefgh.supabase.co:5432/postgres";

describe("the sink's production refusal", () => {
  it("refuses in production with no hermetic opt-in, however the sink is set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-prod-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "production");
      setEnv("EMAIL_SINK_ALLOW_HERMETIC", undefined);
      setEnv("DATABASE_URL", HERMETIC_DB);
      assert.equal(isEmailSinkActive(), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses in production when the opt-in is set but the database is a real one", () => {
    // The load-bearing case. An operator who copies EMAIL_SINK_ALLOW_HERMETIC
    // into a real dashboard must still not get a mail black hole, and the
    // database is what tells the two apart.
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-prod-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "production");
      setEnv("EMAIL_SINK_ALLOW_HERMETIC", "1");
      setEnv("DATABASE_URL", PRODUCTION_DB);
      assert.equal(isEmailSinkActive(), false);
      assert.equal(isEmailDeliveryConfigured(), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses in production when the opt-in is set but there is no database at all", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-prod-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "production");
      setEnv("EMAIL_SINK_ALLOW_HERMETIC", "1");
      setEnv("DATABASE_URL", undefined);
      assert.equal(isEmailSinkActive(), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a truthy-but-not-1 opt-in, so a stray 'true' does not open it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-prod-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "production");
      setEnv("DATABASE_URL", HERMETIC_DB);
      for (const value of ["true", "yes", "0", ""]) {
        setEnv("EMAIL_SINK_ALLOW_HERMETIC", value);
        assert.equal(isEmailSinkActive(), false, `EMAIL_SINK_ALLOW_HERMETIC=${value} must refuse`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOWS it when both locks are turned, which is what CI's built server needs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-hermetic-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "production");
      setEnv("EMAIL_SINK_ALLOW_HERMETIC", "1");
      setEnv("DATABASE_URL", HERMETIC_DB);

      assert.equal(isEmailSinkActive(), true);
      // The 503 the send route raises comes from this predicate, so it is the
      // one that actually has to flip.
      assert.equal(isEmailDeliveryConfigured(), true);

      await sendEmail({ to: "hiring@example.invalid", subject: "S", text: "body" });
      const lines = readFileSync(path.join(dir, "outbox.jsonl"), "utf8").trim().split("\n");
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).subject, "S");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still needs EMAIL_SINK_DIR — the opt-in alone diverts nothing", () => {
    setEnv("EMAIL_SINK_DIR", undefined);
    setEnv("NODE_ENV", "production");
    setEnv("EMAIL_SINK_ALLOW_HERMETIC", "1");
    setEnv("DATABASE_URL", HERMETIC_DB);
    assert.equal(isEmailSinkActive(), false);
  });

  it("leaves non-production behaviour exactly as it was, with no opt-in needed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-email-dev-"));
    try {
      process.env.EMAIL_SINK_DIR = dir;
      setEnv("NODE_ENV", "development");
      setEnv("EMAIL_SINK_ALLOW_HERMETIC", undefined);
      setEnv("DATABASE_URL", PRODUCTION_DB);
      assert.equal(isEmailSinkActive(), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
