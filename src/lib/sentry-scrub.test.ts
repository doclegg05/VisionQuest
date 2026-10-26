import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ErrorEvent, Event, EventHint } from "@sentry/nextjs";
import { scrubPii } from "./sentry-scrub";

// Review F14 / SEC-06 (2026-09-01). The password-reset token travels in a
// URL (forgot-password/route.ts builds /reset-password?token=...), so any
// client error on that page, or a traced server request to it, carries a
// live one-hour token in request.url, query_string, and navigation
// breadcrumbs unless the scrub strips it. These fixtures are synthetic
// events shaped the way the SDK builds them.

const TOKEN = "tok_LIVE_RESET_9f8e7d6c";
const CODE = "otp_123456";
const PASSWORD = "hunter2-correct-horse";
const HINT: EventHint = {};

function resetPageEvent(): ErrorEvent {
  return {
    type: undefined,
    message: "boom",
    user: { id: "u1", email: "student@example.org", username: "student", ip_address: "10.0.0.9" },
    request: {
      url: `https://vq.example/reset-password?token=${TOKEN}&x=1#code=${CODE}`,
      query_string: `token=${TOKEN}&x=1`,
      headers: {
        cookie: "vq_session=abc",
        Authorization: "Bearer secret",
        "x-forwarded-for": "10.0.0.9",
        "user-agent": "test-agent",
      },
      cookies: { vq_session: "abc" },
    },
    breadcrumbs: [
      {
        category: "navigation",
        data: { from: "/login", to: `/reset-password?token=${TOKEN}` },
      },
      {
        category: "fetch",
        data: { url: `https://vq.example/api/auth/reset-password?token=${TOKEN}`, method: "POST", status_code: 500 },
      },
      { category: "console", message: `GET /reset-password?token=${TOKEN} for student@example.org` },
    ],
  };
}

function serialized(event: unknown): string {
  return JSON.stringify(event);
}

describe("scrubPii: secret-bearing URL parameters", () => {
  it("strips the reset token and code from request.url", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    assert.ok(out);
    assert.doesNotMatch(serialized(out.request?.url), new RegExp(TOKEN));
    assert.doesNotMatch(serialized(out.request?.url), new RegExp(CODE));
    // The rest of the URL survives so the event is still debuggable.
    assert.match(out.request?.url ?? "", /^https:\/\/vq\.example\/reset-password\?token=\[REDACTED\]&x=1/);
  });

  it("strips the token from request.query_string in all three SDK shapes", () => {
    const asString = scrubPii(resetPageEvent(), HINT);
    assert.doesNotMatch(serialized(asString?.request?.query_string), new RegExp(TOKEN));

    const arrayEvent = resetPageEvent();
    arrayEvent.request!.query_string = [["token", TOKEN], ["x", "1"]];
    const asArray = scrubPii(arrayEvent, HINT);
    assert.doesNotMatch(serialized(asArray?.request?.query_string), new RegExp(TOKEN));
    assert.match(serialized(asArray?.request?.query_string), /\["x","1"\]/);

    const objectEvent = resetPageEvent();
    objectEvent.request!.query_string = { token: TOKEN, x: "1" };
    const asObject = scrubPii(objectEvent, HINT);
    assert.doesNotMatch(serialized(asObject?.request?.query_string), new RegExp(TOKEN));
    assert.match(serialized(asObject?.request?.query_string), /"x":"1"/);
  });

  it("strips tokens from breadcrumb URLs (data.url, data.from, data.to) and messages", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    assert.doesNotMatch(serialized(out?.breadcrumbs), new RegExp(TOKEN));
    // Untouched breadcrumb fields survive.
    assert.match(serialized(out?.breadcrumbs), /"method":"POST"/);
    assert.match(serialized(out?.breadcrumbs), /"from":"\/login"/);
  });

  it("leaves the whole event free of the token", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    assert.doesNotMatch(serialized(out), new RegExp(TOKEN));
  });
});

describe("scrubPii: request bodies", () => {
  it("drops request.data entirely on auth routes", () => {
    const event = resetPageEvent();
    event.request!.url = "https://vq.example/api/auth/login";
    event.request!.data = { studentId: "STU-001", password: PASSWORD };
    const out = scrubPii(event, HINT);
    assert.equal(out?.request?.data, undefined);
    assert.doesNotMatch(serialized(out), new RegExp(PASSWORD));
  });

  it("redacts secret-named keys in a JSON body elsewhere and keeps the other keys", () => {
    const event = resetPageEvent();
    event.request!.url = "https://vq.example/api/chat/send";
    event.request!.data = { message: "hello", nested: { token: TOKEN, password: PASSWORD, keep: "yes" } };
    const out = scrubPii(event, HINT);
    const text = serialized(out?.request?.data);
    assert.doesNotMatch(text, new RegExp(TOKEN));
    assert.doesNotMatch(text, new RegExp(PASSWORD));
    assert.match(text, /"message":"hello"/);
    assert.match(text, /"keep":"yes"/);
  });

  it("redacts secrets inside a raw string body", () => {
    const event = resetPageEvent();
    event.request!.url = "https://vq.example/api/chat/send";
    event.request!.data = `{"token":"${TOKEN}","other":"fine"}`;
    const out = scrubPii(event, HINT);
    assert.doesNotMatch(serialized(out?.request?.data), new RegExp(TOKEN));
    assert.match(serialized(out?.request?.data), /other/);
  });
});

describe("scrubPii: existing guarantees still hold", () => {
  it("removes user email, username, ip, and id", () => {
    // W11 (2026-09-06): `user.id` is the student's cuid, which resolves to one
    // student's record for anyone who can also read the database
    // (.claude/rules/security.md). Before this it was the one user field kept.
    const out = scrubPii(resetPageEvent(), HINT);
    assert.deepEqual(out?.user, {});
  });

  it("removes cookies and the cookie, authorization, and x-forwarded-for headers regardless of case", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    assert.equal(out?.request?.cookies, undefined);
    assert.deepEqual(out?.request?.headers, { "user-agent": "test-agent" });
  });

  it("redacts email addresses in breadcrumb messages", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    const consoleCrumb = out?.breadcrumbs?.find((b) => b.category === "console");
    assert.match(consoleCrumb?.message ?? "", /\[EMAIL_REDACTED\]/);
    assert.doesNotMatch(consoleCrumb?.message ?? "", /student@example\.org/);
  });

  it("returns an event without user, request, or breadcrumbs unchanged", () => {
    const bare: ErrorEvent = { type: undefined, message: "plain" };
    assert.deepEqual(scrubPii(bare, HINT), bare);
  });
});

// ---------------------------------------------------------------------------
// Employer capability tokens in the PATH (2026-09-06).
//
// F14's rule matches `key=value`, which covers `?token=`. PR #204 then added
// tokens that are a path SEGMENT — `/connect/<token>` (the employer response
// page) and `/api/connect/employer/<token>/…` (its three actions) — and those
// URLs land in `request.url`, in the referer header, and in navigation and
// fetch breadcrumbs. The token is a 14-day bearer capability over a student's
// packet and résumé, so a copy of it sitting in Sentry is a copy of that
// access. Verified before the fix: a realistic event came out of `scrubPii`
// with the token intact everywhere, while `?token=` in the same event was
// redacted.
// ---------------------------------------------------------------------------

/** Shaped like the real thing: 32 random bytes, base64url, 43 characters. */
const EMPLOYER_TOKEN = "hQ7nZ2xK9vB4mL0pR6sT8wY1cD3fG5jN7qA2eU4iO6k";

function employerPacketEvent(): ErrorEvent {
  return {
    type: undefined,
    message: "boom",
    request: {
      url: `https://vq.example/connect/${EMPLOYER_TOKEN}`,
      headers: {
        referer: `https://vq.example/connect/${EMPLOYER_TOKEN}`,
        "user-agent": "test-agent",
      },
    },
    breadcrumbs: [
      {
        category: "navigation",
        data: { from: "/", to: `/connect/${EMPLOYER_TOKEN}` },
      },
      {
        category: "fetch",
        data: {
          url: `https://vq.example/api/connect/employer/${EMPLOYER_TOKEN}/interested`,
          method: "POST",
          status_code: 500,
        },
      },
      {
        category: "console",
        message: `POST /api/connect/employer/${EMPLOYER_TOKEN}/hired failed`,
      },
    ],
  };
}

describe("scrubPii: employer capability tokens in the path", () => {
  it("leaves the whole event free of the token", () => {
    const out = scrubPii(employerPacketEvent(), HINT);

    assert.doesNotMatch(
      serialized(out),
      new RegExp(EMPLOYER_TOKEN),
      "a 14-day bearer capability over a student's packet must not reach Sentry anywhere in the event",
    );
  });

  it("redacts the token in request.url", () => {
    const out = scrubPii(employerPacketEvent(), HINT);
    assert.equal(out.request?.url, "https://vq.example/connect/[REDACTED]");
  });

  it("redacts the token in the referer header", () => {
    // Headers were filtered but never text-scrubbed, so the referer carried a
    // full copy of whatever the URL carried.
    const out = scrubPii(employerPacketEvent(), HINT);
    assert.equal(out.request?.headers?.referer, "https://vq.example/connect/[REDACTED]");
  });

  it("redacts the token in navigation, fetch, and console breadcrumbs", () => {
    const out = scrubPii(employerPacketEvent(), HINT);
    const crumb = (category: string) => out.breadcrumbs?.find((b) => b.category === category);

    assert.equal((crumb("navigation")?.data as { to: string }).to, "/connect/[REDACTED]");
    assert.equal(
      (crumb("fetch")?.data as { url: string }).url,
      "https://vq.example/api/connect/employer/[REDACTED]/interested",
    );
    assert.match(crumb("console")?.message ?? "", /\/api\/connect\/employer\/\[REDACTED\]\/hired/);
  });

  it("leaves short /connect/ segments alone", () => {
    // Only a segment long enough to be a token is redacted. A route name is
    // not a secret, and blanking it would cost the one thing the event is
    // for — knowing which page broke.
    const event: ErrorEvent = {
      type: undefined,
      request: { url: "https://vq.example/connect/report" },
      breadcrumbs: [{ category: "navigation", data: { to: "/connect/report" } }],
    };

    const out = scrubPii(event, HINT);
    assert.equal(out.request?.url, "https://vq.example/connect/report");
    assert.equal((out.breadcrumbs?.[0]?.data as { to: string }).to, "/connect/report");
  });

  it("redacts the connection id on the student approve/withdraw routes", () => {
    // Not collateral damage — a Connection.id resolves to one student's
    // employer disclosure, and a student identifier is PII in a log sink
    // (.claude/rules/security.md). The route still names itself.
    const connectionId = "clz9k2m4x0001qw8h7v3n5t2b";
    const event: ErrorEvent = {
      type: undefined,
      request: { url: `https://vq.example/api/connect/${connectionId}/approve` },
    };

    const out = scrubPii(event, HINT);
    assert.equal(out.request?.url, "https://vq.example/api/connect/[REDACTED]/approve");
  });

  it("leaves the staff Connect routes readable", () => {
    // On these the segment after /connect/ is a literal and the id sits a
    // level deeper, so the rule does not reach it. Pinned so a future
    // widening of the pattern has to face this case on purpose.
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: "https://vq.example/api/teacher/connect/employers/clz9k2m4x0001qw8h7v3n5t2b/contacts",
      },
    };

    const out = scrubPii(event, HINT);
    assert.match(out.request?.url ?? "", /\/api\/teacher\/connect\/employers\//);
  });

  it("still redacts the reset token in a query parameter (F14 unchanged)", () => {
    // The path rule is additive. This is the case F14 shipped, re-asserted
    // here so a future edit to `redactText` cannot trade one for the other.
    const out = scrubPii(resetPageEvent(), HINT);
    assert.doesNotMatch(serialized(out), new RegExp(TOKEN));
    assert.match(out.request?.url ?? "", /token=\[REDACTED\]/);
  });
});

// ---------------------------------------------------------------------------
// Review W1 (2026-09-06). `scrubPii` patched only `user`, `request`, and
// `breadcrumbs`, but the same function is `beforeSendTransaction` as well
// (sentry.client.config.ts:12). A transaction carries the URL in
// `transaction`, `spans[].description`, `spans[].data["http.url"]`, and
// `contexts.trace.data["http.url"]`; an error event carries it in `message`,
// `exception.values[].value`, `extra`, and `tags`. Verified before the fix: a
// token placed in each of those fields came back out of `scrubPii` intact.
// ---------------------------------------------------------------------------

/** A second minted-shaped token so a leak here cannot be masked by the first. */
const TRANSACTION_TOKEN = "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4c";

function transactionEvent(): Event {
  return {
    type: "transaction",
    transaction: `GET /connect/${TRANSACTION_TOKEN}`,
    message: `rendering /connect/${TRANSACTION_TOKEN}`,
    exception: {
      values: [
        {
          type: "Error",
          value: `fetch failed for https://vq.example/api/connect/employer/${TRANSACTION_TOKEN}/hired`,
        },
      ],
    },
    extra: { lastUrl: `https://vq.example/connect/${TRANSACTION_TOKEN}` },
    tags: { route: `/connect/${TRANSACTION_TOKEN}`, sampled: true },
    contexts: {
      trace: {
        trace_id: "1".repeat(32),
        span_id: "2".repeat(16),
        data: { "http.url": `https://vq.example/connect/${TRANSACTION_TOKEN}` },
      },
    },
    spans: [
      {
        span_id: "3".repeat(16),
        trace_id: "1".repeat(32),
        start_timestamp: 0,
        description: `GET /connect/${TRANSACTION_TOKEN}`,
        data: { "http.url": `https://vq.example/api/connect/employer/${TRANSACTION_TOKEN}/interested` },
      },
    ],
  };
}

describe("scrubPii: every event field a capability URL reaches", () => {
  it("leaves no copy of the token anywhere in a serialized transaction event", () => {
    const out = scrubPii(transactionEvent(), HINT);

    assert.doesNotMatch(
      serialized(out),
      new RegExp(TRANSACTION_TOKEN),
      "beforeSendTransaction sends the whole event; every field that can carry the URL must be scrubbed",
    );
  });

  it("redacts the token in transaction, message, extra, and tags", () => {
    const out = scrubPii(transactionEvent(), HINT);

    assert.equal(out.transaction, "GET /connect/[REDACTED]");
    assert.equal(out.message, "rendering /connect/[REDACTED]");
    assert.equal((out.extra as { lastUrl: string }).lastUrl, "https://vq.example/connect/[REDACTED]");
    assert.equal(out.tags?.route, "/connect/[REDACTED]");
    // A non-string tag survives unchanged.
    assert.equal(out.tags?.sampled, true);
  });

  it("redacts the token in contexts.trace.data and in exception values", () => {
    const out = scrubPii(transactionEvent(), HINT);

    assert.equal(
      (out.contexts?.trace?.data as { "http.url": string })["http.url"],
      "https://vq.example/connect/[REDACTED]",
    );
    assert.equal(
      out.exception?.values?.[0]?.value,
      "fetch failed for https://vq.example/api/connect/employer/[REDACTED]/hired",
    );
    // The trace ids the event is threaded by are untouched.
    assert.equal(out.contexts?.trace?.trace_id, "1".repeat(32));
  });

  it("redacts the token in span descriptions and span data", () => {
    const out = scrubPii(transactionEvent(), HINT);
    const span = out.spans?.[0];

    assert.equal(span?.description, "GET /connect/[REDACTED]");
    assert.equal(
      (span?.data as { "http.url": string })["http.url"],
      "https://vq.example/api/connect/employer/[REDACTED]/interested",
    );
    assert.equal(span?.span_id, "3".repeat(16));
  });

  it("catches the token behind an uppercased path and a doubled slash", () => {
    // A URL is not case-normalized on its way into an event, and a doubled
    // slash survives every layer between the browser and Sentry.
    const event: Event = {
      type: undefined,
      transaction: `GET /CONNECT/${TRANSACTION_TOKEN}`,
      message: `GET /connect//${TRANSACTION_TOKEN}`,
      request: { url: `https://vq.example/Api/Connect/Employer/${TRANSACTION_TOKEN}/hired` },
    };

    const out = scrubPii(event, HINT);
    assert.doesNotMatch(serialized(out), new RegExp(TRANSACTION_TOKEN));
    assert.equal(out.transaction, "GET /CONNECT/[REDACTED]");
    assert.equal(out.message, "GET /connect//[REDACTED]");
  });

  it("leaves an operator-useful transaction name alone", () => {
    // The whole point of the transaction field is knowing which route broke.
    const event: Event = { type: "transaction", transaction: "GET /teacher/connect" };

    const out = scrubPii(event, HINT);
    assert.equal(out.transaction, "GET /teacher/connect");
  });
});

describe("Sentry configs route through the scrub", () => {
  const configs = ["sentry.server.config.ts", "sentry.edge.config.ts", "sentry.client.config.ts"];
  for (const name of configs) {
    it(`${name} wires scrubPii into beforeSend and beforeSendTransaction`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");
      assert.match(source, /import \{ scrubPii \} from "\.\/src\/lib\/sentry-scrub"/);
      assert.match(source, /beforeSend: scrubPii/, `${name} lacks beforeSend: scrubPii`);
      assert.match(source, /beforeSendTransaction: scrubPii/, `${name} lacks beforeSendTransaction: scrubPii`);
    });
  }
});

// ---------------------------------------------------------------------------
// Review W11 (2026-09-06). Two gaps that survived the W1 field sweep above:
// `redactText` knew emails and secrets but not PHONE NUMBERS, so a Twilio
// error quoting a student's handset reached Sentry through every field the
// sweep routes; and `user.id` — the student's cuid — was the one user field
// deliberately kept. Verified before the fix: the phone came back intact in
// `exception.values[].value`, and `user.id` came back verbatim.
// ---------------------------------------------------------------------------

const STUDENT_EMAIL = "tanesha.rivers@example.org";
const STUDENT_PHONE = "+13045550142";
const STUDENT_PHONE_FORMATTED = "(304) 555-0142";
const STUDENT_CUID = "clzstudent00000000000042";

function studentContactEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `notification failed for ${STUDENT_EMAIL}`,
    user: { id: STUDENT_CUID, email: STUDENT_EMAIL },
    exception: {
      values: [
        {
          type: "Error",
          value: `The 'To' number ${STUDENT_PHONE} is not a valid phone number`,
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: `sms to ${STUDENT_PHONE_FORMATTED} bounced` },
    ],
    extra: { lastRecipient: STUDENT_PHONE },
  };
}

describe("scrubPii: student contact details and user.id (W11)", () => {
  it("redacts a student email in event.message", () => {
    const out = scrubPii(studentContactEvent(), HINT);
    assert.doesNotMatch(out.message ?? "", new RegExp(STUDENT_EMAIL.replace(".", "\\.")));
    assert.match(out.message ?? "", /notification failed for/);
  });

  it("redacts a phone number in exception.values[].value", () => {
    const out = scrubPii(studentContactEvent(), HINT);
    const value = out.exception?.values?.[0]?.value ?? "";
    assert.ok(!value.includes(STUDENT_PHONE), `phone reached Sentry: ${value}`);
    assert.match(value, /is not a valid phone number/, "the provider's reason survives");
  });

  it("redacts a separator-formatted phone number in a breadcrumb message", () => {
    const out = scrubPii(studentContactEvent(), HINT);
    const crumb = out.breadcrumbs?.[0]?.message ?? "";
    assert.ok(!crumb.includes(STUDENT_PHONE_FORMATTED), `phone reached Sentry: ${crumb}`);
    assert.ok(!crumb.includes("555-0142"));
  });

  it("drops user.id", () => {
    const out = scrubPii(studentContactEvent(), HINT);
    assert.equal(out.user?.id, undefined);
    assert.equal(out.user?.email, undefined);
  });

  it("keeps only `segment` on user: any other field, named or not, is dropped (allowlist)", () => {
    // 2026-09-07 audit: the old denylist let an unnamed custom field such as
    // displayName through. Nothing sets one today; this pins that nothing can.
    const event = studentContactEvent();
    event.user = { ...event.user, segment: "cohort-a", displayName: "Jordan Alvarez" } as Event["user"];
    const out = scrubPii(event, HINT);
    assert.deepEqual(out.user, { segment: "cohort-a" });
    assert.ok(!serialized(out).includes("Jordan Alvarez"));
  });

  it("leaves no copy of the email, the phone, or the cuid anywhere in the event", () => {
    const out = scrubPii(studentContactEvent(), HINT);
    const text = serialized(out);
    assert.ok(!text.includes(STUDENT_EMAIL));
    assert.ok(!text.includes(STUDENT_PHONE));
    assert.ok(!text.includes("555-0142"));
    assert.ok(!text.includes(STUDENT_CUID));
  });

  it("leaves bare digit runs alone so trace ids and timestamps survive", () => {
    // The phone rule is the one log-redaction.ts already uses: E.164 or
    // separator-formatted only. A 32-hex trace id and an epoch are not phones.
    const event: Event = {
      type: undefined,
      message: "failed at 1755691234567 with code 21211",
      contexts: { trace: { trace_id: "1".repeat(32), span_id: "2".repeat(16) } },
    };
    const out = scrubPii(event, HINT);
    assert.equal(out.message, "failed at 1755691234567 with code 21211");
    assert.equal(out.contexts?.trace?.trace_id, "1".repeat(32));
  });
});
