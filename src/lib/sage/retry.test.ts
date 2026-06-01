import assert from "node:assert/strict";
import test from "node:test";
import { retryWithBackoff } from "./retry";

const opts = { label: "Test op", alertKey: "test_exhausted" };

test("returns the value without retrying on first success", async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return "ok";
  }, opts);

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("retries transient failures then succeeds", async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    if (calls < 2) throw new Error("transient");
    return 42;
  }, opts);

  assert.equal(result, 42);
  assert.equal(calls, 2);
});

test("throws the last error after exhausting all attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("always fails");
        },
        { ...opts, maxAttempts: 2 },
      ),
    /always fails/,
  );

  assert.equal(calls, 2);
});
