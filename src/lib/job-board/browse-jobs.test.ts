import assert from "node:assert/strict";
import { mock, test, before } from "node:test";

const queries: unknown[] = [];
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobBrowseListing: {
        findMany: async (args: unknown) => { queries.push(args); return []; },
      },
    },
  },
});

let loadBrowseJobs: typeof import("./browse-jobs").loadBrowseJobs;

before(async () => {
  const mod = await import("./browse-jobs");
  loadBrowseJobs = mod.loadBrowseJobs;
});

test("loadBrowseJobs queries only active, non-expired listings", async () => {
  await loadBrowseJobs({ proximity: "all", sort: "recent", searchParams: new URLSearchParams() });
  const arg = queries[0] as { where: { status: string; expiresAt: { gt: Date } } };
  assert.equal(arg.where.status, "active");
  assert.ok(arg.where.expiresAt.gt instanceof Date);
});

test("loadBrowseJobs returns empty array for proximity=local", async () => {
  const result = await loadBrowseJobs({ proximity: "local", sort: "recent", searchParams: new URLSearchParams() });
  assert.deepEqual(result, []);
});

test("loadBrowseJobs applies cluster filter when cluster param is present", async () => {
  const beforeCount = queries.length;
  await loadBrowseJobs({ proximity: "all", sort: "recent", searchParams: new URLSearchParams("cluster=office-admin") });
  const arg = queries[beforeCount] as { where: { clusters?: { has: string } } };
  assert.deepEqual(arg.where.clusters, { has: "office-admin" });
});

test("loadBrowseJobs omits cluster predicate when no cluster param", async () => {
  const beforeCount = queries.length;
  await loadBrowseJobs({ proximity: "all", sort: "recent", searchParams: new URLSearchParams() });
  const arg = queries[beforeCount] as { where: { clusters?: unknown } };
  assert.equal(arg.where.clusters, undefined);
});
