import { test } from "node:test";
import assert from "node:assert/strict";
import { postOrientationCompletion } from "./OrientationWizard";

function fetchStub(
  impl: () => Promise<Response> | never
): typeof fetch & { calls: { input: RequestInfo | URL; init?: RequestInit }[] } {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const stub = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return impl();
  };
  return Object.assign(stub as typeof fetch, { calls });
}

test("postOrientationCompletion returns true and posts to the complete route on a 2xx response", async () => {
  const fetchFn = fetchStub(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  );

  const saved = await postOrientationCompletion(fetchFn);

  assert.equal(saved, true);
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].input, "/api/orientation/complete");
  assert.equal(fetchFn.calls[0].init?.method, "POST");
});

test("postOrientationCompletion returns false on a non-2xx response", async () => {
  const fetchFn = fetchStub(() =>
    Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 }))
  );

  const saved = await postOrientationCompletion(fetchFn);

  assert.equal(saved, false);
});

test("postOrientationCompletion returns false (never throws) when fetch rejects", async () => {
  const fetchFn = fetchStub(() => Promise.reject(new Error("network down")));

  const saved = await postOrientationCompletion(fetchFn);

  assert.equal(saved, false);
});
