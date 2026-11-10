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
