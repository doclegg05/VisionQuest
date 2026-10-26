import assert from "node:assert/strict";
import { afterEach, beforeEach, it, mock } from "node:test";
import { startGoalPolling } from "./goal-polling";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let cancel: (() => void) | undefined;
beforeEach(() => { mock.timers.enable({ apis: ["setTimeout"] }); });
afterEach(() => { cancel?.(); cancel = undefined; mock.restoreAll(); mock.timers.reset(); });

it("cancels a scheduled poll before it makes any request", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("unexpected fetch"); });
  cancel = startGoalPolling(0, () => assert.fail("unexpected capture"));
  cancel();
  mock.timers.tick(30_000);
  await flush();
  assert.equal(fetch.mock.callCount(), 0);
});

it("never overlaps slow requests and aborts an in-flight request on cleanup", async () => {
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  const fetch = mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, options?: RequestInit) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>((done) => { resolve = done; });
  });
  const captured = mock.fn();
  cancel = startGoalPolling(0, captured);
  mock.timers.tick(3000);
  mock.timers.tick(30_000);
  assert.equal(fetch.mock.callCount(), 1);
  cancel();
  assert.equal(signal?.aborted, true);
  resolve(Response.json({ goals: [{ level: "weekly" }] }));
  await flush();
  mock.timers.tick(30_000);
  assert.equal(captured.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 1);
});

it("ignores a response body that finishes after cancellation", async () => {
  let resolve!: (value: unknown) => void;
  mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: () => new Promise((done) => { resolve = done; }),
  } as Response));
  const captured = mock.fn();
  cancel = startGoalPolling(0, captured);
  mock.timers.tick(3000);
  await flush();
  cancel();
  resolve({ goals: [{ level: "weekly" }] });
  await flush();
  assert.equal(captured.mock.callCount(), 0);
});

it("stops after five unsuccessful attempts, including failed responses", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  cancel = startGoalPolling(0, () => assert.fail("unexpected capture"));
  for (let i = 0; i < 8; i++) {
    mock.timers.tick(3000);
    await flush();
  }
  assert.equal(fetch.mock.callCount(), 5);
});

it("retries unchanged goals and network errors without exceeding the budget", async () => {
  let attempt = 0;
  const fetch = mock.method(globalThis, "fetch", async () => {
    if (++attempt % 2 === 0) throw new Error("offline");
    return Response.json({ goals: [] });
  });
  cancel = startGoalPolling(0, () => assert.fail("unexpected capture"));
  for (let i = 0; i < 8; i++) {
    mock.timers.tick(3000);
    await flush();
  }
  assert.equal(fetch.mock.callCount(), 5);
});

it("reports the new goal once and stops polling", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => Response.json({ goals: [{ level: "weekly" }] }));
  const captured = mock.fn();
  cancel = startGoalPolling(0, captured);
  mock.timers.tick(3000);
  await flush();
  mock.timers.tick(30_000);
  await flush();
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(captured.mock.calls.map((call) => call.arguments), [["weekly"]]);
});
