import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorEvent, Event } from "@sentry/nextjs";
import { errorOnlyIntegrations, PRIVATE_REPORTING_OPTIONS, scrubPii, sendNothing, withheldServerEvent } from "./sentry-scrub";

// The guarantees earlier reviews pinned, restated for the allowlist scrub
// (H1 privacy follow-up, 2026-11-10). Before it, each of these was a
// redaction rule that kept the rest of the string; now the string is not sent
// at all, so each test asserts that the secret is gone and that the event
// still says which route broke. The per-leak tests from the 2026-11-10 audit
// are in sentry-scrub.leaks.test.ts.
//
// - F14 / SEC-06 (2026-09-01): the password-reset token travels as
//   /reset-password?token=... and reached request.url, query_string and
//   navigation breadcrumbs.
// - 2026-09-06: employer capability tokens are a path SEGMENT
//   (/connect/<token>, /api/connect/employer/<token>/...), as are staff
//   invite tokens (/invite/<token>).
// - W1 (2026-09-06): transactions carry the URL in six more fields.
// - W11 (2026-09-06): phone numbers and `user.id`.

/** Shaped like a minted token (43 base64url characters), built here so no real one is pinned. */
function token(seed: string): string {
  return seed.repeat(15).slice(0, 43);
}

const RESET_TOKEN = token("rT7-q");
const EMPLOYER_TOKEN = token("Zk3-_");
const INVITE_TOKEN = token("mN4_x");
const STUDENT_EMAIL = "tanesha.rivers@example.org";
const STUDENT_PHONE = "+13045550142";
const STUDENT_PHONE_FORMATTED = "(304) 555-0142";
const STUDENT_CUID = "clzstudent00000000000042";

function serialized(event: unknown): string {
  return JSON.stringify(event);
}

function resetPageEvent(): ErrorEvent {
  return {
    type: undefined,
    message: "boom",
    user: { id: STUDENT_CUID, email: STUDENT_EMAIL, username: "student", ip_address: "10.0.0.9", segment: "cohort-a" },
    request: {
      url: `https://vq.example/reset-password?token=${RESET_TOKEN}&x=1#code=otp_123456`,
      query_string: `token=${RESET_TOKEN}&x=1`,
      headers: { cookie: "vq_session=abc", Authorization: "Bearer abc", "x-forwarded-for": "10.0.0.9", "user-agent": "test-agent" },
      cookies: { vq_session: "abc" },
      data: { studentId: "STU-001", newPassword: "correct horse" },
    },
    breadcrumbs: [
      { category: "navigation", data: { from: "/login", to: `/reset-password?token=${RESET_TOKEN}` } },
      { category: "console", message: `GET /reset-password?token=${RESET_TOKEN} for ${STUDENT_EMAIL}` },
    ],
  };
}

describe("scrubPii: secrets in URLs", () => {
  it("sends no copy of the reset token, and still names the page", () => {
    const out = scrubPii(resetPageEvent(), {});
    assert.ok(!serialized(out).includes(RESET_TOKEN));
    assert.ok(!serialized(out).includes("otp_123456"));
    assert.equal(out?.tags?.route, "/reset-password");
  });

  for (const path of [`/connect/${EMPLOYER_TOKEN}`, `/api/connect/employer/${EMPLOYER_TOKEN}/hired`, `/CONNECT//${EMPLOYER_TOKEN}`, `/invite/${INVITE_TOKEN}?x=1`]) {
    it(`sends no capability token from ${path.replace(/[A-Za-z0-9_-]{43}/, "<token>")}`, () => {
      const event: ErrorEvent = {
        type: undefined,
        transaction: `GET ${path}`,
        request: { url: `https://vq.example${path}`, headers: { referer: `https://vq.example${path}` } },
        tags: { route: path },
        extra: { lastUrl: `https://vq.example${path}` },
      };
      const out = scrubPii(event, {});
      assert.ok(!serialized(out).includes(EMPLOYER_TOKEN) && !serialized(out).includes(INVITE_TOKEN), serialized(out));
    });
  }

  it("names the employer routes by pattern", () => {
    const event: ErrorEvent = { type: undefined, request: { url: `https://vq.example/api/connect/employer/${EMPLOYER_TOKEN}/hired` } };
    assert.equal(scrubPii(event, {})?.tags?.route, "/api/connect/employer/[param]/hired");
  });

  it("the pattern rules still catch a token in a source path, the one free string left", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [{ filename: `/srv/connect/${EMPLOYER_TOKEN}/page.js` }] } }] },
    };
    const frame = scrubPii(event, {})?.exception?.values?.[0]?.stacktrace?.frames?.[0];
    assert.equal(frame?.filename, "/srv/connect/[REDACTED]/page.js");
  });
});

describe("scrubPii: the request and the user", () => {
  it("sends no request at all: no body, cookie, header or query string, on an auth route or any other", () => {
    const out = scrubPii(resetPageEvent(), {});
    assert.equal(out?.request, undefined);
    assert.ok(!serialized(out).includes("correct horse"));
    assert.ok(!serialized(out).includes("vq_session"));
    assert.ok(!serialized(out).includes("test-agent"));
  });

  it("sends no user field, `segment` included", () => {
    // 2026-09-07 kept `segment` as the one allowlisted user field. Nothing
    // sets it, and a cohort label is free text, so it goes too.
    const out = scrubPii(resetPageEvent(), {});
    assert.equal(out?.user, undefined);
    assert.ok(!serialized(out).includes("cohort-a"));
  });

  it("sends no email, phone number or record id from any field (W11)", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: `notification failed for ${STUDENT_EMAIL}`,
      user: { id: STUDENT_CUID, email: STUDENT_EMAIL },
      exception: { values: [{ type: "Error", value: `The 'To' number ${STUDENT_PHONE} is not a valid phone number` }] },
      breadcrumbs: [{ category: "console", message: `sms to ${STUDENT_PHONE_FORMATTED} bounced` }],
      extra: { lastRecipient: STUDENT_PHONE },
    };
    const text = serialized(scrubPii(event, {}));
    for (const secret of [STUDENT_EMAIL, STUDENT_PHONE, "555-0142", STUDENT_CUID]) {
      assert.ok(!text.includes(secret), `${secret} reached Sentry: ${text}`);
    }
  });

  it("returns a bare event as it came", () => {
    const bare: ErrorEvent = { type: undefined, event_id: "0".repeat(32), level: "error" };
    assert.deepEqual(scrubPii(bare, {}), bare);
  });
});

describe("scrubPii: transactions (W1)", () => {
  it("sends none, so no span, description or http.url can carry a URL", () => {
    const event: Event = {
      type: "transaction",
      transaction: `GET /connect/${EMPLOYER_TOKEN}`,
      spans: [{ span_id: "3".repeat(16), trace_id: "1".repeat(32), start_timestamp: 0, data: { "http.url": `/connect/${EMPLOYER_TOKEN}` } }],
    };
    assert.equal(scrubPii(event, {}), null);
  });

  it("keeps a route name on an error event, by pattern", () => {
    const event: ErrorEvent = { type: undefined, transaction: "GET /teacher/connect" };
    assert.equal(scrubPii(event, {})?.transaction, "GET /teacher/connect");
    const withId: ErrorEvent = { type: undefined, transaction: `POST /teacher/students/${STUDENT_CUID}` };
    assert.equal(scrubPii(withId, {})?.transaction, "POST /teacher/students/[param]");
    const freeText: ErrorEvent = { type: undefined, transaction: "rendering the page for Tanesha" };
    assert.equal(scrubPii(freeText, {})?.transaction, undefined);
  });
});

describe("the options every runtime spreads", () => {
  it("record no breadcrumb, send no transaction, client report or default PII, and scrub every error", () => {
    assert.equal(PRIVATE_REPORTING_OPTIONS.beforeSend, scrubPii);
    assert.equal(PRIVATE_REPORTING_OPTIONS.beforeSendTransaction, sendNothing);
    assert.equal(PRIVATE_REPORTING_OPTIONS.beforeBreadcrumb, sendNothing);
    assert.equal(PRIVATE_REPORTING_OPTIONS.maxBreadcrumbs, 0);
    assert.equal(PRIVATE_REPORTING_OPTIONS.sendClientReports, false);
    assert.equal(PRIVATE_REPORTING_OPTIONS.sendDefaultPii, false);
    assert.equal(sendNothing(), null);
  });

  it("keep an integration only when it is named", () => {
    const names = ["GlobalHandlers", "Breadcrumbs", "BrowserSession", "HttpContext", "SomethingTheSdkAddsNextYear"];
    assert.deepEqual(errorOnlyIntegrations(names.map((name) => ({ name }))), [{ name: "GlobalHandlers" }]);
  });
});

describe("withheldServerEvent", () => {
  function serverEvent(): ErrorEvent {
    return {
      type: undefined,
      exception: { values: [{ type: "PrismaClientValidationError", value: 'where: { displayName: "Tanesha Rivers" }' }] },
      request: { url: `https://vq.example/api/teacher/students/${STUDENT_CUID}?q=Tanesha`, data: { displayName: "Tanesha Rivers" }, method: "POST" },
      breadcrumbs: [{ category: "fetch", data: { url: "https://storage.example/students/Tanesha.pdf" } }],
      user: { ip_address: "10.0.0.9" },
      extra: { attempts: 2, note: "Tanesha" },
      tags: { runtime: "node" },
    };
  }

  it("drops the request, the breadcrumbs, the user and every extra that is not a number or boolean", () => {
    const out = withheldServerEvent({ route: "/api/x", method: "POST", status: 500 })(serverEvent());
    assert.equal(out.request, undefined);
    assert.equal(out.breadcrumbs, undefined);
    assert.equal(out.user, undefined);
    assert.deepEqual(out.extra, { attempts: 2 });
    assert.doesNotMatch(serialized(out), /Tanesha/);
  });

  it("withholds the exception message, keeps its type, and the scrub keeps the code", () => {
    const out = withheldServerEvent({ route: "/api/x", method: "POST", status: 500, errorCode: "P2002" })(serverEvent());
    assert.equal(out.exception?.values?.[0]?.type, "PrismaClientValidationError");
    assert.equal(out.exception?.values?.[0]?.value, "[message withheld] code P2002");
    assert.equal(scrubPii(out, {})?.exception?.values?.[0]?.value, "[message withheld] code P2002");
  });

  it("names the route, method and status, and the scrub keeps exactly those tags", () => {
    const out = withheldServerEvent({ route: "/api/teacher/students/[param]", method: "POST", status: 500 })(serverEvent());
    assert.equal(out.transaction, "POST /api/teacher/students/[param]");
    const scrubbed = scrubPii(out, {});
    assert.deepEqual(scrubbed?.tags, { route: "/api/teacher/students/[param]", method: "POST", status: "500" });
    assert.equal(scrubbed?.transaction, "POST /api/teacher/students/[param]");
  });

  it("does not touch a message event's message", () => {
    const event: ErrorEvent = { type: undefined, message: "wellbeing_no_recipients" };
    assert.equal(withheldServerEvent({})(event).message, "wellbeing_no_recipients");
  });
});
