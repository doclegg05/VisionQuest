import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let claims = 0;
let failClaim = false;
mock.module("./db", { namedExports: { prismaAdmin: {
  $queryRaw: async () => {
    claims++;
    if (failClaim) throw new Error("claim failed");
    return [{ id: `job-${claims}`, type: "capacity", payload: "{}", attempts: 1 }];
  },
  backgroundJob: { update: async () => ({}) },
} } });
mock.module("./logger", { namedExports: { logger: { error: () => {} } } });
mock.module("./log-keys", { namedExports: { studentLogKey: () => "redacted" } });
let processJobs: typeof import("./jobs").processJobs;
let processJobById: typeof import("./jobs").processJobById;
let registerJobHandler: typeof import("./jobs").registerJobHandler;
let claimPendingJobs: typeof import("./jobs").claimPendingJobs;
before(async () => {
  ({ processJobs, processJobById, registerJobHandler, claimPendingJobs } = await import("./jobs"));
});

test("inline and cron share bounded worker capacity, overflow stays unclaimed", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  registerJobHandler("capacity", () => gate);
  const work = [processJobs(), processJobs(), processJobById("a"), processJobById("b")];
  assert.equal(await processJobs(), 0);
  assert.equal(await processJobById("c"), 0);
  assert.equal(claims, 4);
  release();
  assert.deepEqual(await Promise.all(work), [1, 1, 1, 1]);
  assert.equal(await processJobs(), 1);
});
test("claim failure releases worker capacity", async () => {
  failClaim = true;
  for (let i = 0; i < 6; i++) await assert.rejects(processJobs(), /claim failed/);
  failClaim = false;
  assert.equal(await processJobs(), 1);
});
test("claim size is bounded before querying the database", async () => {
  const before = claims;
  for (const limit of [0, -1, 101, Infinity, NaN, 1.5]) await assert.rejects(claimPendingJobs(limit), /limit/);
  assert.equal(claims, before);
});
