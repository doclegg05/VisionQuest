/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const TO_NUMBER = "+15551234567";

const mockDebug = mock.fn() as any;
const mockInfo = mock.fn() as any;
const mockWarn = mock.fn() as any;
const mockError = mock.fn() as any;

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      get debug() {
        return mockDebug;
      },
      get info() {
        return mockInfo;
      },
      get warn() {
        return mockWarn;
      },
      get error() {
        return mockError;
      },
    },
  },
});

let sms: typeof import("./sms");

before(async () => {
  sms = await import("./sms");
});

const originalFetch = global.fetch;
const originalEnv = {
  sid: process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  from: process.env.TWILIO_FROM_NUMBER,
};

function loggedText(): string {
  const calls = [
    ...mockDebug.mock.calls,
    ...mockInfo.mock.calls,
    ...mockWarn.mock.calls,
    ...mockError.mock.calls,
  ];
  return JSON.stringify(calls.map((c: any) => c.arguments));
}

describe("sendSms logging", () => {
  beforeEach(() => {
    for (const m of [mockDebug, mockInfo, mockWarn, mockError]) m.mock.resetCalls();
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_FROM_NUMBER = "+15559999999";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TWILIO_ACCOUNT_SID = originalEnv.sid;
    process.env.TWILIO_AUTH_TOKEN = originalEnv.token;
    process.env.TWILIO_FROM_NUMBER = originalEnv.from;
  });

  it("logs no recipient number on a successful send", async () => {
    global.fetch = (async () => ({ ok: true, status: 201 })) as unknown as typeof fetch;

    const sent = await sms.sendSms(TO_NUMBER, "hello");

    assert.equal(sent, true);
    const logged = loggedText();
    assert.ok(!logged.includes(TO_NUMBER), `success log leaked the number: ${logged}`);
  });

  it("logs no recipient number when Twilio rejects the request", async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 400,
      text: async () => `{"code":21211,"message":"The 'To' number ${TO_NUMBER} is not valid"}`,
    })) as unknown as typeof fetch;

    const sent = await sms.sendSms(TO_NUMBER, "hello");

    assert.equal(sent, false);
    const logged = loggedText();
    assert.ok(!logged.includes(TO_NUMBER), `failure log leaked the number: ${logged}`);
    assert.ok(logged.includes("21211"), "dropped the Twilio error code needed to debug");
    assert.ok(logged.includes("400"), "dropped the HTTP status");
  });

  it("logs no recipient number when the request throws", async () => {
    global.fetch = (async () => {
      throw new Error(`socket hang up while sending to ${TO_NUMBER}`);
    }) as unknown as typeof fetch;

    const sent = await sms.sendSms(TO_NUMBER, "hello");

    assert.equal(sent, false);
    const logged = loggedText();
    assert.ok(!logged.includes(TO_NUMBER), `thrown-error log leaked the number: ${logged}`);
    assert.ok(logged.includes("socket hang up"), "dropped the failure reason");
  });
});
