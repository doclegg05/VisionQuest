// Secret redaction for anything a scorer puts into a result file.
//
// Result files are committed on main, uploaded as artifacts, pasted into a
// step summary, and quoted in the regression issue. A scorer that reports
// "connect ECONNREFUSED postgresql://user:hunter2@db.host/prod" would publish
// that string in four places at once.
import test from "node:test";
import assert from "node:assert/strict";

import { SECRET_ENV_NAMES, redactSecrets, redactDeep } from "../lib/redact.mjs";

const env = {
  DATABASE_URL: "postgresql://app:s3cr3tpassword@db.internal:5432/visionquest",
  GEMINI_API_KEY: "AIzaSyEXAMPLEKEY1234567890",
  BENCH_PROD_READONLY_URL: "postgresql://ro:anotherlongsecret@prod.host/db",
  TWILIO_AUTH_TOKEN: "short1", // 6 chars — too short to match safely
  DIRECT_URL: "",
};

test("every secret the runner can hand a scorer is on the list", () => {
  assert.deepEqual(
    [...SECRET_ENV_NAMES].sort(),
    [
      "ADMIN_DATABASE_URL",
      "BENCH_PROD_READONLY_URL",
      "CRON_CHECK_DATABASE_URL",
      "DATABASE_URL",
      "DIRECT_URL",
      "GEMINI_API_KEY",
      "TWILIO_AUTH_TOKEN",
    ]
  );
});

test("a set secret's value is replaced by a named placeholder", () => {
  const text = `connect failed: ${env.DATABASE_URL}`;
  const redacted = redactSecrets(text, env);
  assert.ok(!redacted.includes("s3cr3tpassword"), redacted);
  assert.ok(redacted.includes("[redacted:DATABASE_URL]"), redacted);
});

test("every occurrence is replaced, not just the first", () => {
  const text = `${env.GEMINI_API_KEY} then again ${env.GEMINI_API_KEY}`;
  const redacted = redactSecrets(text, env);
  assert.equal(redacted.includes("AIzaSyEXAMPLEKEY1234567890"), false);
  assert.equal(redacted.split("[redacted:GEMINI_API_KEY]").length - 1, 2);
});

test("a short or unset value is never used as a needle", () => {
  // "short1" would otherwise match inside ordinary words and mangle output.
  assert.equal(redactSecrets("short1 and shortcut", env), "short1 and shortcut");
  assert.equal(redactSecrets("nothing here", { DIRECT_URL: "" }), "nothing here");
});

test("a Postgres credential is scrubbed even when it is not one of ours", () => {
  const text = "pool error on postgresql://someone:hunter2@other.host:5432/db";
  const redacted = redactSecrets(text, {});
  assert.ok(!redacted.includes("hunter2"), redacted);
  assert.ok(redacted.includes("[redacted-credentials]"), redacted);
  assert.ok(redacted.includes("other.host"), "the host stays — it is the useful part");
});

test("the postgres:// scheme is covered too", () => {
  const redacted = redactSecrets("postgres://u:p4ssword@h/db", {});
  assert.ok(!redacted.includes("p4ssword"), redacted);
});

test("a non-string is returned untouched", () => {
  assert.equal(redactSecrets(null, env), null);
  assert.equal(redactSecrets(42, env), 42);
});

test("redactDeep walks nested details without changing their shape", () => {
  const details = {
    failures: [
      { label: "conn", message: `boom ${env.DATABASE_URL}` },
      { label: "fine", message: "ok" },
    ],
    count: 2,
    nested: { deeper: [`${env.GEMINI_API_KEY}`] },
  };
  const redacted = redactDeep(details, env);
  assert.equal(redacted.count, 2);
  assert.equal(redacted.failures.length, 2);
  assert.equal(redacted.failures[1].message, "ok");
  assert.ok(redacted.failures[0].message.includes("[redacted:DATABASE_URL]"));
  assert.ok(redacted.nested.deeper[0].includes("[redacted:GEMINI_API_KEY]"));
  assert.equal(
    JSON.stringify(redacted).includes("s3cr3tpassword"),
    false,
    "nothing secret survives serialisation"
  );
});

test("redactDeep leaves the original object alone", () => {
  const details = { message: `x ${env.DATABASE_URL}` };
  redactDeep(details, env);
  assert.ok(details.message.includes("s3cr3tpassword"));
});
