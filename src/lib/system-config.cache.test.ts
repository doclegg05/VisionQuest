import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { invalidatePrefix } from "./cache";

const findUnique = mock.fn(async (_args: unknown): Promise<{ value: string } | null> => ({ value: "original" }));
const upsert = mock.fn(async (_args: unknown) => ({}));
const deleteMany = mock.fn(async (_args: unknown) => ({ count: 1 }));
mock.module("@/lib/db", { namedExports: { prismaAdmin: { systemConfig: { findUnique, upsert, deleteMany } } } });
// No real secrets, crypto configuration or database access in these tests.
mock.module("@/lib/crypto", { namedExports: {
  encrypt: (value: string) => `test:${value}`,
  decrypt: (value: string) => value.replace(/^test:/, ""),
} });
let config: typeof import("./system-config");
before(async () => { config = await import("./system-config"); });
beforeEach(() => {
  invalidatePrefix("sysconfig:");
  findUnique.mock.resetCalls();
  upsert.mock.resetCalls();
  deleteMany.mock.resetCalls();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

test("20 concurrent config reads issue one Prisma query", async () => {
  const reads = Array.from({ length: 20 }, () => config.getPlainConfigValue("ai_provider"));
  assert.deepEqual(await Promise.all(reads), Array(20).fill("original"));
  assert.equal(findUnique.mock.callCount(), 1);
  assert.deepEqual(findUnique.mock.calls[0].arguments[0], { where: { key: "ai_provider" }, select: { value: true } });
});

for (const operation of ["plain write", "encrypted write", "delete"] as const) {
  test(`${operation} during pending config read cannot resurrect old data`, async () => {
    const old = deferred<{ value: string } | null>();
    findUnique.mock.mockImplementationOnce(() => old.promise);
    const pending = config.getPlainConfigValue("ai_provider");
    await Promise.resolve();
    if (operation === "plain write") await config.setPlainConfigValue("ai_provider", "fresh", "admin");
    if (operation === "encrypted write") await config.setConfigValue("ai_provider", "fresh", "admin");
    if (operation === "delete") await config.deleteConfigValue("ai_provider");
    findUnique.mock.mockImplementationOnce(async () => operation === "delete" ? null : { value: "fresh" });
    assert.equal(await config.getPlainConfigValue("ai_provider"), operation === "delete" ? null : "fresh");
    old.resolve({ value: "old" });
    assert.equal(await pending, "old");
    assert.equal(await config.getPlainConfigValue("ai_provider"), operation === "delete" ? null : "fresh");
    assert.equal(findUnique.mock.callCount(), 2);
  });
}
