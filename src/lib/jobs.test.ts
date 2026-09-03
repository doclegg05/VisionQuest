import assert from "node:assert/strict";
import test from "node:test";
import { prismaAdmin as prisma } from "@/lib/db";
import { enqueueJob, processJobById, processJobs, registerJobHandler } from "@/lib/jobs";
import { studentLogKey } from "@/lib/log-keys";

type FindFirstArgs = Parameters<typeof prisma.backgroundJob.findFirst>[0];
type CreateArgs = Parameters<typeof prisma.backgroundJob.create>[0];
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

function stubBackgroundJobFindFirst(result: unknown) {
  const calls: FindFirstArgs[] = [];
  const original = prisma.backgroundJob.findFirst;
  (prisma.backgroundJob.findFirst as unknown as (args: FindFirstArgs) => Promise<unknown>) = async (
    args: FindFirstArgs,
  ) => {
    calls.push(args);
    return result;
  };
  return {
    calls,
    restore() {
      prisma.backgroundJob.findFirst = original;
    },
  };
}

function stubBackgroundJobCreate() {
  const calls: CreateArgs[] = [];
  const original = prisma.backgroundJob.create;
  (prisma.backgroundJob.create as unknown as (args: CreateArgs) => Promise<unknown>) = async (
    args: CreateArgs,
  ) => {
    calls.push(args);
    return { id: "created-job" };
  };
  return {
    calls,
    restore() {
      prisma.backgroundJob.create = original;
    },
  };
}

test("enqueueJob persists the dedupe key on newly created jobs", async () => {
  const findStub = stubBackgroundJobFindFirst(null);
  const createStub = stubBackgroundJobCreate();

  try {
    const jobId = await enqueueJob({
      type: "scrape_jobs",
      payload: { configId: "config-1" },
      dedupeKey: "scrape:config-1",
    });

    assert.equal(jobId, "created-job");
    assert.equal(findStub.calls.length, 1);
    assert.equal(createStub.calls.length, 1);
    assert.equal(createStub.calls[0].data.dedupeKey, "scrape:config-1");
  } finally {
    findStub.restore();
    createStub.restore();
  }
});

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

test("processJobById claims and runs one specific pending job", async () => {
  const restoreClaim = stubQueryRaw([
    { id: "job-specific", type: "test_specific", payload: JSON.stringify({ source: "manual" }), attempts: 1 },
  ]);
  const updateStub = stubBackgroundJobUpdate();

  let handlerCalledWith: unknown = null;
  registerJobHandler("test_specific", async (payload) => {
    handlerCalledWith = payload;
  });

  try {
    const processed = await processJobById("job-specific");
    assert.equal(processed, 1);
    assert.deepEqual(handlerCalledWith, { source: "manual" });
    assert.equal(updateStub.calls.length, 1);
    assert.equal(updateStub.calls[0].where.id, "job-specific");
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

// Review F59 (2026-09-01): BackgroundJob.error and the "Job failed" log line
// take the handler's message verbatim, which is outside the reach of the
// logger lint rule. The runner scrubs any student id it can see in the
// payload before either sink receives the message.
test("processJobs keeps a payload student id out of the error column and the log line", async () => {
  const studentId = "cmf9x1y2z0000abcdefghijkl";
  const restoreClaim = stubQueryRaw([
    { id: "job-5", type: "test_fail_leaky", payload: JSON.stringify({ studentId }), attempts: 1 },
  ]);
  const updateStub = stubBackgroundJobUpdate();
  const consoleLines: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleLines.push(args.map(String).join(" "));
  };

  registerJobHandler("test_fail_leaky", async (payload) => {
    // This fixture is the leak the runner must scrub, so the F59 rule fires
    // on it by design; real code fixes the line instead of disabling the rule.
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`briefing: agent turn failed for student ${(payload as { studentId: string }).studentId}`);
  });

  try {
    await processJobs(1);
    const stored = String(updateStub.calls[0].data.error);
    assert.doesNotMatch(stored, new RegExp(studentId));
    assert.match(stored, new RegExp(studentLogKey(studentId)));
    assert.match(stored, /agent turn failed/);
    const logged = consoleLines.join("\n");
    assert.match(logged, /Job failed/);
    assert.doesNotMatch(logged, new RegExp(studentId));
  } finally {
    console.error = originalConsoleError;
    restoreClaim();
    updateStub.restore();
  }
});
