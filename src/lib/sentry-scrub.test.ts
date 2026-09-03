import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
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
  it("removes user email, username, and ip, and keeps the id", () => {
    const out = scrubPii(resetPageEvent(), HINT);
    assert.deepEqual(out?.user, { id: "u1" });
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
