import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import { processJobs, registerJobHandler } from "@/lib/jobs";

type UpdateArgs = Parameters<typeof prisma.backgroundJob.update>[0];

interface ClaimedRow {
  id: string;
  type: string;
  payload: string;
  attempts: number;
}

function stubQueryRaw(rows: ClaimedRow[]) {
  const original = prisma.$queryRaw;
  (prisma.$queryRaw as unknown as (...args: unknown[]) => Promise<ClaimedRow[]>) = async () => rows;
  return () => {
    prisma.$queryRaw = original;
  };
}

function stubBackgroundJobUpdate() {
  const calls: UpdateArgs[] = [];
  const original = prisma.backgroundJob.update;
  (prisma.backgroundJob.update as unknown as (args: UpdateArgs) => Promise<unknown>) = async (
    args: UpdateArgs,
  ) => {
    calls.push(args);
    return {} as unknown;
  };
  return {
    calls,
    restore() {
      prisma.backgroundJob.update = original;
    },
  };
}

test("processJobs runs handler and marks job completed on success", async () => {
  const restoreClaim = stubQueryRaw([
    { id: "job-1", type: "test_success", payload: JSON.stringify({ n: 1 }), attempts: 1 },
  ]);
  const updateStub = stubBackgroundJobUpdate();

  let handlerCalledWith: unknown = null;
  registerJobHandler("test_success", async (payload) => {
    handlerCalledWith = payload;
  });

  try {
    const processed = await processJobs(1);
    assert.equal(processed, 1);
    assert.deepEqual(handlerCalledWith, { n: 1 });
    assert.equal(updateStub.calls.length, 1);
    assert.equal(updateStub.calls[0].where.id, "job-1");
    assert.equal(updateStub.calls[0].data.status, "completed");
  } finally {
    restoreClaim();
    updateStub.restore();
  }
});

test("processJobs marks job failed when type is unknown", async () => {
  const restoreClaim = stubQueryRaw([
    { id: "job-2", type: "unregistered_type", payload: "{}", attempts: 1 },
  ]);
  const updateStub = stubBackgroundJobUpdate();

  try {
    const processed = await processJobs(1);
    assert.equal(processed, 0);
    assert.equal(updateStub.calls.length, 1);
    assert.equal(updateStub.calls[0].data.status, "failed");
    assert.match(String(updateStub.calls[0].data.error), /Unknown job type/);
  } finally {
    restoreClaim();
    updateStub.restore();
  }
});

test("processJobs re-queues with status=pending when handler throws and attempts < 3", async () => {
  const restoreClaim = stubQueryRaw([
    { id: "job-3", type: "test_fail_retry", payload: "{}", attempts: 2 },
  ]);
  const updateStub = stubBackgroundJobUpdate();

  registerJobHandler("test_fail_retry", async () => {
    throw new Error("transient boom");
  });

  try {
    const processed = await processJobs(1);
    assert.equal(processed, 0);
    assert.equal(updateStub.calls.length, 1);
    assert.equal(updateStub.calls[0].data.status, "pending");
    assert.equal(updateStub.calls[0].data.error, "transient boom");
  } finally {
    restoreClaim();
    updateStub.restore();
  }
});

test("processJobs marks failed when handler throws and attempts === 3 (final attempt)", async () => {
  const restoreClaim = stubQueryRaw([
    { id: "job-4", type: "test_fail_final", payload: "{}", attempts: 3 },
  ]);
  const updateStub = stubBackgroundJobUpdate();

  registerJobHandler("test_fail_final", async () => {
    throw new Error("fatal boom");
  });

  try {
    const processed = await processJobs(1);
    assert.equal(processed, 0);
    assert.equal(updateStub.calls[0].data.status, "failed");
    assert.equal(updateStub.calls[0].data.error, "fatal boom");
  } finally {
    restoreClaim();
    updateStub.restore();
  }
});

test("processJobs returns 0 immediately when nothing is claimed", async () => {
  const restoreClaim = stubQueryRaw([]);
  const updateStub = stubBackgroundJobUpdate();

  try {
    const processed = await processJobs(5);
    assert.equal(processed, 0);
    assert.equal(updateStub.calls.length, 0);
  } finally {
    restoreClaim();
    updateStub.restore();
  }
});
