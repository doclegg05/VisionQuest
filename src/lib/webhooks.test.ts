import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let release: () => void;
let gate: Promise<void>;
let active = 0;
let peak = 0;
let deliveries = 0;
let fail = false;
const logs: unknown[] = [];
mock.module("./db", { namedExports: { prismaAdmin: {
  webhookSubscription: { findMany: async () => Array.from({ length: 10 }, (_, i) => ({
    id: String(i), url: "https://hooks.example/secret-token", secret: "signing-secret", eventTypes: [],
  })) },
} } });
mock.module("./cache", { namedExports: {
  cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  invalidatePrefix: () => {},
} });
mock.module("./logger", { namedExports: { logger: { error: (...args: unknown[]) => logs.push(args) } } });
mock.module("./safe-outbound-request", { namedExports: {
  safeOutboundPost: async (_url: string, body: string, headers: Record<string, string>) => {
    assert.equal(JSON.parse(body).eventType, "goal.confirmed");
    assert.match(headers["X-VisionQuest-Signature"], /^[a-f0-9]{64}$/);
    active++;
    deliveries++;
    peak = Math.max(peak, active);
    try {
      await gate;
      if (fail) throw new Error("https://hooks.example/secret-token signing-secret");
    } finally { active--; }
  },
} });
let dispatchWebhookEvent: typeof import("./webhooks").dispatchWebhookEvent;
before(async () => { ({ dispatchWebhookEvent } = await import("./webhooks")); });
test("bounded worker fanout and dispatch admission, with no retained waiting queue", async () => {
  gate = new Promise<void>((resolve) => { release = resolve; });
  const runs = Array.from({ length: 4 }, () => dispatchWebhookEvent("goal.confirmed", {}));
  await assert.rejects(dispatchWebhookEvent("goal.confirmed", {}), /capacity/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 16);
  release();
  await Promise.all(runs);
  assert.equal(deliveries, 40);
  assert.equal(peak, 16);
});
test("delivery failures log neither URL nor exception text; capacity recovers", async () => {
  fail = true;
  await dispatchWebhookEvent("goal.confirmed", {});
  assert.equal(logs.length, 10);
  assert.doesNotMatch(JSON.stringify(logs), /secret-token|signing-secret|hooks.example/);
});
