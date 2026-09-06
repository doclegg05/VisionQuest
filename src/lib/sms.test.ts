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
    delete process.env.SMS_SEND_TIMEOUT_MS;
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

  it("gives up on a Twilio call that never answers, and reports it as not sent", async () => {
    // Without a timeout `fetch` waits as long as the socket stays open, and
    // every caller's own bound is then a claim rather than a guarantee — the
    // nudge runner's deadline margin most of all, since it is sized for one
    // in-flight send. The fake below never resolves on its own; only the
    // abort ends it, so this fails outright if the signal is dropped.
    let sawSignal = false;
    global.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hangs forever: no timeout was passed
        sawSignal = true;
        signal.addEventListener("abort", () => {
          // What undici does on an aborted request.
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;

    // Shortened so the case proves the timeout in milliseconds rather than
    // holding the suite for the real ten seconds. The env knob is production
    // behaviour, not a test seam bolted on: an operator can lengthen it.
    process.env.SMS_SEND_TIMEOUT_MS = "50";
    // `AbortSignal.timeout()` uses an UNREF'd timer, so it does not by itself
    // keep the event loop alive. With nothing else pending, node:test bails
    // with "promise resolution is still pending" before the abort ever fires
    // — which looks exactly like a missing timeout and is not one.
    const keepAlive = setTimeout(() => {}, 5_000);
    const started = Date.now();
    const sent = await sms.sendSms(TO_NUMBER, "hello");
    const elapsed = Date.now() - started;
    clearTimeout(keepAlive);

    assert.equal(sawSignal, true, "the request must carry an abort signal");
    assert.equal(sent, false, "an abandoned send is a failed send, not a hang");
    assert.ok(elapsed < 5_000, `took ${elapsed}ms; the send must give up, not hang`);
    const logged = loggedText();
    assert.ok(!logged.includes(TO_NUMBER), `abort log leaked the number: ${logged}`);
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
