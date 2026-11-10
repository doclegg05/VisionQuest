import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRlsContext, withRlsContext } from "./rls-context";
import { createKeyedSerialRunner } from "./keyed-serial-runner";

// One running, at most one queued behind it, per key. The queued run starts
// after the running one settles, so it reads every write that committed
// before then. Different keys never wait on each other.

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
  readonly fail: (error: Error) => void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Probe {
  readonly runs: () => number;
  readonly maxConcurrent: () => number;
  readonly task: (release: Promise<void>) => () => Promise<void>;
}

function probe(): Probe {
  let runs = 0;
  let active = 0;
  let peak = 0;
  return {
    runs: () => runs,
    maxConcurrent: () => peak,
    task: (release) => async () => {
      runs += 1;
      active += 1;
      peak = Math.max(peak, active);
      try {
        await release;
      } finally {
        active -= 1;
      }
    },
  };
}

describe("createKeyedSerialRunner", () => {
  it("runs a second call for the same key after the first, never alongside it", async () => {
    const runner = createKeyedSerialRunner();
    const p = probe();
    const first = gate();
    const second = gate();

    const a = runner.run("student-a", p.task(first.promise));
    const b = runner.run("student-a", p.task(second.promise));
    await flush();
    assert.equal(p.runs(), 1, "the second run must wait for the first");

    first.open();
    await a;
    await flush();
    assert.equal(p.runs(), 2, "the queued run starts once the first settles");

    second.open();
    await b;
    assert.equal(p.runs(), 2);
    assert.equal(p.maxConcurrent(), 1, "two runs for one key overlapped");
  });

  it("collapses ten calls into two runs: the running one and one queued", async () => {
    const runner = createKeyedSerialRunner();
    const p = probe();
    const release = gate();

    const calls = Array.from({ length: 10 }, () => runner.run("student-a", p.task(release.promise)));
    await flush();
    assert.equal(p.runs(), 1);

    release.open();
    await Promise.all(calls);
    assert.equal(p.runs(), 2);
    assert.equal(p.maxConcurrent(), 1);
  });

  it("does not make different keys wait on each other", async () => {
    const runner = createKeyedSerialRunner();
    const p = probe();
    const held = gate();

    void runner.run("student-a", p.task(held.promise));
    const b = runner.run("student-b", p.task(Promise.resolve()));
    await b;
    assert.equal(p.runs(), 2, "student-b waited on student-a");
    assert.equal(p.maxConcurrent(), 2);
    held.open();
  });

  it("still runs the queued call when the first one throws", async () => {
    const runner = createKeyedSerialRunner();
    const p = probe();
    const first = gate();

    const a = runner.run("student-a", p.task(first.promise));
    const b = runner.run("student-a", p.task(Promise.resolve()));
    first.fail(new Error("sync blew up"));

    await assert.rejects(a, /sync blew up/, "the first caller still hears its own failure");
    await b;
    assert.equal(p.runs(), 2, "the queued run was lost when the first threw");
  });

  it("starts fresh after a key goes idle", async () => {
    const runner = createKeyedSerialRunner();
    const p = probe();
    await runner.run("student-a", p.task(Promise.resolve()));
    await runner.run("student-a", p.task(Promise.resolve()));
    assert.equal(p.runs(), 2);
  });

  it("runs a queued task as the actor of the call that queued it", async () => {
    const runner = createKeyedSerialRunner();
    const first = gate();
    const seen: Array<ReturnType<typeof getRlsContext>> = [];
    const record = (release: Promise<void>) => async () => {
      seen.push(getRlsContext());
      await release;
    };
    const actorA = { userId: "actor-a", role: "student", studentId: "student-a" };
    const actorB = { userId: "actor-b", role: "student", studentId: "student-a" };

    const a = withRlsContext(actorA, () => runner.run("student-a", record(first.promise)));
    const b = withRlsContext(actorB, () => runner.run("student-a", record(Promise.resolve())));
    // Released from outside both scopes, as the first run's completion is.
    assert.equal(getRlsContext(), undefined);
    first.open();
    await Promise.all([a, b]);

    assert.deepEqual(seen, [actorA, actorB], "the queued run took the first run's actor");
  });
});

// Database review of readiness F3, 2026-11-10: the runner was keyed only, so
// a class of 30 signing the same form started 30 syncs at once against a pool
// of 5, and the deferred work starved the requests students were making. A
// cap across keys bounds that. The cap needs a deadline with it, or two runs
// that never settle would stop every deferred run in the process.
describe("createKeyedSerialRunner with a cap across keys", () => {
  it("runs no more than the cap at once, whatever the keys", async () => {
    const runner = createKeyedSerialRunner({ maxConcurrent: 2 });
    const work = probe();
    const gates = Array.from({ length: 5 }, () => gate());
    const all = gates.map((held, index) => runner.run(`student-${index}`, work.task(held.promise)));

    await flush();
    assert.equal(work.runs(), 2, "a third run started while two were still going");
    gates[0].open();
    await flush();
    assert.equal(work.runs(), 3, "a finished run did not hand its place on");
    gates.forEach((held) => held.open());
    await Promise.all(all);

    assert.equal(work.runs(), 5, "every key still got its run");
    assert.equal(work.maxConcurrent(), 2);
  });

  it("still runs one at a time per key under the cap", async () => {
    const runner = createKeyedSerialRunner({ maxConcurrent: 2 });
    const sameKey = probe();
    const first = gate();
    const a1 = runner.run("student-a", sameKey.task(first.promise));
    const a2 = runner.run("student-a", sameKey.task(Promise.resolve()));

    await flush();
    assert.equal(sameKey.runs(), 1, "a free place let the same key run twice at once");
    first.open();
    await Promise.all([a1, a2]);

    assert.equal(sameKey.runs(), 2);
    assert.equal(sameKey.maxConcurrent(), 1);
  });

  it("runs a task that waited for a place as the actor of the call that queued it", async () => {
    const runner = createKeyedSerialRunner({ maxConcurrent: 1 });
    const first = gate();
    const seen: Array<ReturnType<typeof getRlsContext>> = [];
    const record = (release: Promise<void>) => async () => {
      seen.push(getRlsContext());
      await release;
    };
    const actorA = { userId: "actor-a", role: "student", studentId: "student-a" };
    const actorB = { userId: "actor-b", role: "student", studentId: "student-b" };

    const a = withRlsContext(actorA, () => runner.run("student-a", record(first.promise)));
    const b = withRlsContext(actorB, () => runner.run("student-b", record(Promise.resolve())));
    assert.equal(getRlsContext(), undefined);
    first.open();
    await Promise.all([a, b]);

    assert.deepEqual(seen, [actorA, actorB], "the waiting run took the actor of the run it waited behind");
  });
});

describe("createKeyedSerialRunner with a deadline", () => {
  it("lets go of a run that never settles: its key and its place are free again", async () => {
    let told = 0;
    const runner = createKeyedSerialRunner({ maxConcurrent: 1, deadlineMs: 20, onDeadline: () => { told += 1; } });
    const work = probe();
    const never = new Promise<void>(() => undefined);

    const stuck = runner.run("student-a", work.task(never));
    const other = runner.run("student-b", work.task(Promise.resolve()));
    await Promise.all([stuck, other]);

    assert.equal(told, 1, "the deadline was not reported exactly once");
    assert.equal(work.runs(), 2, "the run waiting for a place never got one");
    await runner.run("student-a", work.task(Promise.resolve()));
    assert.equal(work.runs(), 3, "the stuck key never ran again");
  });

  it("says nothing about a run that finishes in time", async () => {
    let told = 0;
    const runner = createKeyedSerialRunner({ deadlineMs: 1000, onDeadline: () => { told += 1; } });

    await runner.run("student-a", async () => undefined);
    await flush();

    assert.equal(told, 0);
  });

  it("raises no unhandled rejection when a stuck run fails after its deadline", async () => {
    const late = gate();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const runner = createKeyedSerialRunner({ deadlineMs: 10 });
      await runner.run("student-a", () => late.promise);
      late.fail(new Error("failed after the deadline"));
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    assert.deepEqual(unhandled, []);
  });
});
