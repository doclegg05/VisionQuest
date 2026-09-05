import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const state = {
  handled: [] as Array<{ from: string; body: string }>,
  handlerThrows: false,
  rateLimitSuccess: true,
  adminPrivileged: true,
  logs: [] as string[],
};

mock.module("@/lib/nudges/replies", {
  namedExports: {
    handleInboundSms: async (input: { from: string; body: string }) => {
      state.handled.push(input);
      if (state.handlerThrows) throw new Error("boom");
      return { outcome: "revoked" as const };
    },
  },
});
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({
      success: state.rateLimitSuccess,
      remaining: 9,
      resetTime: 0,
      degraded: false,
    }),
  },
});
mock.module("@/lib/nudges/admin-guard", {
  namedExports: {
    adminClientIsPrivileged: async () => state.adminPrivileged,
    resetAdminClientProbe: () => {},
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: (message: string, payload?: unknown) =>
        state.logs.push(`${message} ${JSON.stringify(payload ?? {})}`),
      warn: (message: string, payload?: unknown) =>
        state.logs.push(`${message} ${JSON.stringify(payload ?? {})}`),
      error: (message: string, payload?: unknown) =>
        state.logs.push(`${message} ${JSON.stringify(payload ?? {})}`),
      debug: () => {},
    },
  },
});

import { buildTwilioSignature } from "@/lib/nudges/twilio-signature";

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

const AUTH_TOKEN = "test-auth-token";
const URL_STRING = "https://visionquest.example.test/api/sms/inbound";
const FROM = "+13045550123";

function request(
  params: Record<string, string>,
  signature: string | null,
): Request {
  const form = new URLSearchParams(params).toString();
  return new Request(URL_STRING, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Twilio always sends one; the route requires it (see MAX_BODY_BYTES).
      "content-length": String(Buffer.byteLength(form)),
      ...(signature === null ? {} : { "x-twilio-signature": signature }),
    },
    body: form,
  });
}

function signed(params: Record<string, string>): Request {
  return request(params, buildTwilioSignature(AUTH_TOKEN, URL_STRING, params));
}

beforeEach(() => {
  state.handled = [];
  state.handlerThrows = false;
  state.rateLimitSuccess = true;
  state.adminPrivileged = true;
  state.logs = [];
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.APP_BASE_URL = "https://visionquest.example.test";
});

describe("POST /api/sms/inbound", () => {
  it("handles a correctly signed STOP and answers with empty TwiML", async () => {
    const response = await POST(signed({ From: FROM, Body: "STOP" }));

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/xml/);
    assert.equal(await response.text(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    assert.deepEqual(state.handled, [{ from: FROM, body: "STOP" }]);
  });

  it("refuses an unsigned request", async () => {
    const response = await POST(request({ From: FROM, Body: "STOP" }, null));
    assert.equal(response.status, 403);
    assert.equal(state.handled.length, 0);
  });

  it("refuses a signature computed over different fields", async () => {
    const signature = buildTwilioSignature(AUTH_TOKEN, URL_STRING, { From: FROM, Body: "Y" });
    const response = await POST(request({ From: FROM, Body: "STOP" }, signature));
    assert.equal(response.status, 403, "a body swapped after signing must not verify");
    assert.equal(state.handled.length, 0);
  });

  it("refuses a signature made with a different auth token", async () => {
    const signature = buildTwilioSignature("wrong-token", URL_STRING, { From: FROM, Body: "STOP" });
    const response = await POST(request({ From: FROM, Body: "STOP" }, signature));
    assert.equal(response.status, 403);
  });

  it("is inert when TWILIO_AUTH_TOKEN is unset — the default install sends nothing", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const response = await POST(signed({ From: FROM, Body: "STOP" }));
    assert.equal(response.status, 403);
    assert.equal(state.handled.length, 0);
  });

  it("never puts a phone number or the message body in a log line", async () => {
    await POST(signed({ From: FROM, Body: "STOP" }));
    const logged = state.logs.join("\n");
    assert.ok(!logged.includes(FROM), `log leaked the number: ${logged}`);
    assert.ok(!logged.includes("3045550123"), `log leaked the number: ${logged}`);
  });

  it("returns 200 rather than an error when the handler throws", async () => {
    // A non-2xx makes Twilio retry, and a retried STOP that half-applied is
    // worse than one logged failure.
    state.handlerThrows = true;
    const response = await POST(signed({ From: FROM, Body: "STOP" }));
    assert.equal(response.status, 200);
    assert.ok(state.logs.some((line) => line.includes("Inbound SMS handling failed")));
  });

  it("drops a message over the per-number limit, still with a 200", async () => {
    state.rateLimitSuccess = false;
    const response = await POST(signed({ From: FROM, Body: "Y" }));
    assert.equal(response.status, 200);
    assert.equal(state.handled.length, 0);
  });

  it("rejects a body with no Content-Length, and one that is too large", async () => {
    // Unauthenticated until the signature check, so an unbounded formData()
    // is a free way to make the server buffer whatever a stranger sends.
    const params = { From: FROM, Body: "STOP" };
    const signature = buildTwilioSignature(AUTH_TOKEN, URL_STRING, params);

    const noLength = new Request(URL_STRING, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(new URLSearchParams(params).toString()));
          controller.close();
        },
      }),
      // @ts-expect-error duplex is required for a streaming body in Node
      duplex: "half",
    });
    assert.equal((await POST(noLength)).status, 400);

    const tooLarge = new Request(URL_STRING, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
        "content-length": String(17 * 1024),
      },
      body: new URLSearchParams(params).toString(),
    });
    assert.equal((await POST(tooLarge)).status, 400);
    assert.equal(state.handled.length, 0);
  });

  it("does nothing but log when the admin client is not privileged (F63)", async () => {
    // A STOP silently dropped is the one failure here that must never be quiet.
    state.adminPrivileged = false;
    const response = await POST(signed({ From: FROM, Body: "STOP" }));
    assert.equal(response.status, 200, "still 200, so Twilio does not retry into it");
    assert.equal(state.handled.length, 0);
    assert.ok(state.logs.some((line) => line.includes("nudges_admin_client_missing")));
  });

  it("signs against the configured public origin, not the proxied request URL", async () => {
    // Render terminates TLS in front of the app, so req.url can be http on an
    // internal host while Twilio signed the public https one.
    const params = { From: FROM, Body: "STOP" };
    const encoded = new URLSearchParams(params).toString();
    const proxied = new Request("http://10.0.0.7:10000/api/sms/inbound", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "content-length": String(Buffer.byteLength(encoded)),
        "x-twilio-signature": buildTwilioSignature(AUTH_TOKEN, URL_STRING, params),
      },
      body: encoded,
    });
    const response = await POST(proxied);
    assert.equal(response.status, 200);
    assert.equal(state.handled.length, 1);
  });
});
