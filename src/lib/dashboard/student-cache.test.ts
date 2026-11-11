import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cached, invalidateAllChatContext, invalidateChatContext } from "@/lib/cache";
import { cachedWhen, globalCacheKey, NotOwnStudentError, ownStudentId, studentCacheKey } from "./student-cache";

const A = { id: "cstudentaaaaaaaaaaaaaaaa1", role: "student" };
const B = { id: "cstudentbbbbbbbbbbbbbbbb2", role: "student" };

/** True when `key` still holds the value put there: the probe fetcher did not run. */
async function stillCached(key: string): Promise<boolean> {
  let refetched = false;
  await cached(key, 60, async () => { refetched = true; return "probe"; });
  return !refetched;
}

describe("dashboard cache keys", () => {
  it("only a student's own session names a key", () => {
    for (const role of ["teacher", "admin", "coordinator", "cdc"]) {
      assert.throws(() => ownStudentId({ id: A.id, role }), NotOwnStudentError);
      assert.throws(() => studentCacheKey({ id: A.id, role }, "shell"), NotOwnStudentError);
    }
    assert.equal(ownStudentId(A), A.id);
  });

  it("a student's chat-context invalidation clears that student's keys and no one else's", async () => {
    const keyA = studentCacheKey(A, "probe");
    const keyB = studentCacheKey(B, "probe");
    await cached(keyA, 60, async () => "a");
    await cached(keyB, 60, async () => "b");
    invalidateChatContext(A.id);
    assert.equal(await stillCached(keyA), false, "A's key survived A's invalidation");
    assert.equal(await stillCached(keyB), true, "B's key was cleared by A's invalidation");
  });

  it("a global key survives a student invalidation and clears with the all-students one", async () => {
    const key = globalCacheKey("probe");
    await cached(key, 60, async () => 8);
    invalidateChatContext(A.id);
    assert.equal(await stillCached(key), true);
    invalidateAllChatContext();
    assert.equal(await stillCached(key), false);
  });
});

describe("cachedWhen", () => {
  it("keeps a value keep() accepts", async () => {
    let reads = 0;
    const read = () => cachedWhen("test:kept", 60, async () => { reads++; return 3; }, (n) => n > 0);
    assert.equal(await read(), 3);
    assert.equal(await read(), 3);
    assert.equal(reads, 1);
  });

  it("returns but never keeps a value keep() rejects, so the next caller reads again", async () => {
    let reads = 0;
    const read = () => cachedWhen("test:empty", 60, async () => { reads++; return 0; }, (n) => n > 0);
    assert.equal(await read(), 0);
    assert.equal(await read(), 0);
    assert.equal(reads, 2);
  });

  it("callers sharing an in-flight rejected value each get a value", async () => {
    const read = () => cachedWhen("test:shared-empty", 60, async () => 0, (n) => n > 0);
    assert.deepEqual(await Promise.all([read(), read(), read()]), [0, 0, 0]);
  });

  it("never keeps a failed read, and the failure reaches the caller", async () => {
    let reads = 0;
    const read = () => cachedWhen("test:failed", 60, async () => {
      reads++;
      if (reads === 1) throw new Error("lost connection");
      return 5;
    }, () => true);
    await assert.rejects(read(), /lost connection/);
    assert.equal(await read(), 5);
  });
});
