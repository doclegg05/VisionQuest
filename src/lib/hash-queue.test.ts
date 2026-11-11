import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CONCURRENT_HASHES, createHashJobRunner, runHashJob } from "./hash-queue";

// Password hashes run on Node's thread pool, which has four threads, and one
// scrypt call at the app's parameters holds about 32 MB while it runs. The
// queue lets a few run and makes the rest wait their turn, so a classroom
// signing in together neither allocates 30 buffers at once nor takes every
// thread the pool has.

/** A job the test finishes by hand. */
interface ManualJob {
  run: () => Promise<string>;
  finish: (value: string) => void;
  fail: (error: Error) => void;
  started: boolean;
}

function manualJob(onStart?: () => void): ManualJob {
  let finish: (value: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const settled = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const job: ManualJob = {
    started: false,
    finish: (value) => finish(value),
    fail: (error) => fail(error),
    run: () => {
      job.started = true;
      onStart?.();
      return settled;
    },
  };
  return job;
}

/** Lets every promise callback that is already due run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("the hash queue", () => {
  it("starts jobs up to the limit and holds the rest back", async () => {
    const run = createHashJobRunner(2);
    const jobs = [manualJob(), manualJob(), manualJob(), manualJob()];
    const results = jobs.map((job) => run(job.run));
    await settle();

    assert.deepEqual(jobs.map((job) => job.started), [true, true, false, false]);

    jobs.forEach((job, index) => job.finish(`done-${index}`));
    assert.deepEqual(await Promise.all(results), ["done-0", "done-1", "done-2", "done-3"]);
  });

  it("starts waiting jobs in the order they arrived, one per slot that frees", async () => {
    const run = createHashJobRunner(1);
    const order: number[] = [];
    const jobs = [0, 1, 2, 3].map((index) => manualJob(() => order.push(index)));
    const results = jobs.map((job) => run(job.run));
    await settle();
    assert.deepEqual(order, [0]);

    jobs[0]?.finish("a");
    await settle();
    assert.deepEqual(order, [0, 1], "one finished job lets exactly one waiting job start");

    jobs[1]?.finish("b");
    jobs[2]?.finish("c");
    jobs[3]?.finish("d");
    assert.deepEqual(await Promise.all(results), ["a", "b", "c", "d"]);
    assert.deepEqual(order, [0, 1, 2, 3]);
  });

  it("never runs more than the limit, however many arrive together", async () => {
    const limit = 3;
    const run = createHashJobRunner(limit);
    let running = 0;
    let mostAtOnce = 0;
    const work = async (index: number): Promise<number> => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      // Finish out of order, so a slot can free while others are still held.
      await new Promise((resolve) => setTimeout(resolve, index % 4));
      running -= 1;
      return index;
    };

    const results = await Promise.all(Array.from({ length: 40 }, (_, index) => run(() => work(index))));

    assert.deepEqual(results, Array.from({ length: 40 }, (_, index) => index));
    assert.equal(mostAtOnce, limit);
    assert.equal(running, 0);
  });

  it("gives a failed job's error to its own caller and frees the slot", async () => {
    const run = createHashJobRunner(1);
    const failing = manualJob();
    const next = manualJob();
    const failed = run(failing.run);
    const followed = run(next.run);
    await settle();
    assert.equal(next.started, false);

    failing.fail(new Error("the hash failed"));
    await assert.rejects(failed, /the hash failed/);
    await settle();
    assert.equal(next.started, true, "the slot a failed job held is free again");

    next.finish("after the failure");
    assert.equal(await followed, "after the failure");
  });

  it("frees the slot when a job throws before it returns a promise", async () => {
    const run = createHashJobRunner(1);
    const throwing = (): Promise<string> => {
      throw new Error("threw at once");
    };

    await assert.rejects(run(throwing), /threw at once/);
    assert.equal(await run(async () => "still usable"), "still usable");
  });

  it("refuses a limit that could never run a job", () => {
    assert.throws(() => createHashJobRunner(0), /at least 1/);
    assert.throws(() => createHashJobRunner(1.5), /at least 1/);
  });
});

describe("the app's hash queue", () => {
  it("leaves threads free for other work: the limit is below Node's default pool of four", () => {
    assert.ok(Number.isInteger(MAX_CONCURRENT_HASHES));
    assert.ok(MAX_CONCURRENT_HASHES >= 1);
    assert.ok(MAX_CONCURRENT_HASHES < 4);
  });

  it("holds the shared runner to that limit", async () => {
    const jobs = Array.from({ length: MAX_CONCURRENT_HASHES + 2 }, () => manualJob());
    const results = jobs.map((job) => runHashJob(job.run));
    await settle();

    assert.equal(jobs.filter((job) => job.started).length, MAX_CONCURRENT_HASHES);

    jobs.forEach((job) => job.finish("done"));
    await Promise.all(results);
  });
});
