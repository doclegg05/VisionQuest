import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchOrientationWizardItems } from "./OrientationWizard";

function jsonStub(body: unknown, status = 200) {
  const calls: string[] = [];
  const stub = (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return Object.assign(stub as typeof fetch, { calls });
}

const ITEM = { id: "a", label: "A", completed: false };

describe("fetchOrientationWizardItems", () => {
  it("sends one request when the wizard and the welcome video ask at the same time", async () => {
    const fetchFn = jsonStub({ items: [ITEM] });

    const [forWizard, forVideo] = await Promise.all([
      fetchOrientationWizardItems(fetchFn),
      fetchOrientationWizardItems(fetchFn),
    ]);

    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(forWizard, [ITEM]);
    assert.deepEqual(forVideo, [ITEM]);
  });

  it("asks again once the first request has finished, so a retry never sees stale data", async () => {
    const fetchFn = jsonStub({ items: [ITEM] });

    await fetchOrientationWizardItems(fetchFn);
    await fetchOrientationWizardItems(fetchFn);

    assert.equal(fetchFn.calls.length, 2);
  });

  it("shares a failure with both callers and then allows a new try", async () => {
    const failing = jsonStub({ error: "down" }, 500);

    const results = await Promise.allSettled([
      fetchOrientationWizardItems(failing),
      fetchOrientationWizardItems(failing),
    ]);

    assert.equal(failing.calls.length, 1);
    assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);

    const healthy = jsonStub({ items: [ITEM] });
    assert.deepEqual(await fetchOrientationWizardItems(healthy), [ITEM]);
    assert.equal(healthy.calls.length, 1);
  });
});
