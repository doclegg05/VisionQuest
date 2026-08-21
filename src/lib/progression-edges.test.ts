import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";
import {
  PREREQUISITE_KIND,
  collectTransitivePrerequisites,
  deriveEdgesFromStatic,
  loadPrerequisiteMap,
  staticPrerequisiteMap,
  syncProgressionEdges,
  type ProgressionEdgeInput,
  type ProgressionEdgeWriter,
} from "@/lib/progression-edges";

// ---------------------------------------------------------------------------
// Referential lock: every static prerequisite id must resolve to a known
// cert or platform id. ProgressionEdge has no FK targets (endpoints are
// static TS ids), so integrity lives here instead of in the database.
// ---------------------------------------------------------------------------

test("every static prerequisite id resolves to a known cert or platform id", () => {
  const knownIds = new Set([
    ...CERTIFICATIONS.map((c) => c.id),
    ...PLATFORMS.map((p) => p.id),
  ]);
  for (const cert of CERTIFICATIONS) {
    for (const prereqId of cert.prerequisites) {
      assert.ok(
        knownIds.has(prereqId),
        `${cert.id} lists unknown prerequisite "${prereqId}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Derivation from the static arrays (the seed source of truth)
// ---------------------------------------------------------------------------

test("deriveEdgesFromStatic emits one edge per static prerequisite entry", () => {
  const edges = deriveEdgesFromStatic();
  const expectedCount = CERTIFICATIONS.reduce(
    (n, c) => n + c.prerequisites.length,
    0,
  );
  assert.equal(edges.length, expectedCount);
  assert.ok(edges.every((e) => e.kind === PREREQUISITE_KIND));
  // Spot-check the deepest structures in the current data.
  assert.ok(
    edges.some((e) => e.fromId === "mos-access" && e.toId === "mos-excel"),
  );
  assert.ok(
    edges.some(
      (e) => e.fromId === "intuit-bookkeeping" && e.toId === "intuit-quickbooks",
    ),
  );
});

test("staticPrerequisiteMap mirrors the static arrays exactly", () => {
  const map = staticPrerequisiteMap();
  for (const cert of CERTIFICATIONS) {
    if (cert.prerequisites.length === 0) {
      assert.equal(map.has(cert.id), false);
    } else {
      assert.deepEqual(map.get(cert.id), cert.prerequisites);
    }
  }
});

// ---------------------------------------------------------------------------
// Transitive traversal (BFS with a visited-set cycle guard)
// ---------------------------------------------------------------------------

test("transitive prerequisites: chain (bookkeeping -> quickbooks -> ic3)", () => {
  const result = collectTransitivePrerequisites(
    "intuit-bookkeeping",
    staticPrerequisiteMap(),
  );
  assert.deepEqual([...result].sort(), ["ic3", "intuit-quickbooks"]);
});

test("transitive prerequisites: diamond (mos-access -> {ic3, mos-excel -> ic3})", () => {
  const result = collectTransitivePrerequisites(
    "mos-access",
    staticPrerequisiteMap(),
  );
  // ic3 is reachable twice (directly and via mos-excel) but appears once.
  assert.deepEqual([...result].sort(), ["ic3", "mos-excel"]);
});

test("transitive prerequisites: cycle terminates and visits every node once", () => {
  const cyclic = new Map<string, string[]>([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["a"]],
  ]);
  const result = collectTransitivePrerequisites("a", cyclic);
  assert.deepEqual([...result].sort(), ["a", "b", "c"]);
});

test("transitive prerequisites: no prerequisites yields empty list", () => {
  assert.deepEqual(
    collectTransitivePrerequisites("ic3", staticPrerequisiteMap()),
    [],
  );
});

// ---------------------------------------------------------------------------
// DB loader: table rows win; an empty table falls back to the static arrays
// (fail-safe — a fresh environment must never unlock gated steps).
// ---------------------------------------------------------------------------

test("loadPrerequisiteMap builds the map from ProgressionEdge rows", async () => {
  const original = prisma.progressionEdge.findMany;
  try {
    (
      prisma.progressionEdge.findMany as unknown as (
        ...args: unknown[]
      ) => Promise<unknown[]>
    ) = async () =>
      deriveEdgesFromStatic().map(({ fromId, toId }) => ({ fromId, toId }));
    const map = await loadPrerequisiteMap();
    assert.deepEqual(map, staticPrerequisiteMap());
  } finally {
    prisma.progressionEdge.findMany = original;
  }
});

test("loadPrerequisiteMap falls back to static arrays when the table is empty", async () => {
  const original = prisma.progressionEdge.findMany;
  try {
    (
      prisma.progressionEdge.findMany as unknown as (
        ...args: unknown[]
      ) => Promise<unknown[]>
    ) = async () => [];
    const map = await loadPrerequisiteMap();
    assert.deepEqual(map, staticPrerequisiteMap());
  } finally {
    prisma.progressionEdge.findMany = original;
  }
});

// ---------------------------------------------------------------------------
// Seed sync: idempotent upsert + prune, tested against an in-memory fake
// that mirrors the two Prisma calls the sync makes.
// ---------------------------------------------------------------------------

interface FakeEdge {
  fromId: string;
  toId: string;
  kind: string;
}

function fakeWriter(initial: FakeEdge[] = []) {
  const store = new Map<string, FakeEdge>();
  const key = (e: FakeEdge) => `${e.fromId}|${e.toId}|${e.kind}`;
  for (const e of initial) store.set(key(e), e);

  const writer: ProgressionEdgeWriter = {
    progressionEdge: {
      upsert: async ({ where, create }) => {
        const k = `${where.fromId_toId_kind.fromId}|${where.fromId_toId_kind.toId}|${where.fromId_toId_kind.kind}`;
        if (!store.has(k)) store.set(k, create);
        return create;
      },
      deleteMany: async ({ where }) => {
        const keep = new Set(
          (where.NOT?.OR ?? []).map(
            (p) => `${p.fromId}|${p.toId}|${where.kind}`,
          ),
        );
        let count = 0;
        for (const [k, e] of [...store.entries()]) {
          if (e.kind === where.kind && !keep.has(k)) {
            store.delete(k);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return { writer, store };
}

test("syncProgressionEdges seeds every derived edge and is idempotent", async () => {
  const { writer, store } = fakeWriter();
  const first = await syncProgressionEdges(writer);
  const sizeAfterFirst = store.size;

  const second = await syncProgressionEdges(writer);

  assert.equal(sizeAfterFirst, deriveEdgesFromStatic().length);
  assert.equal(store.size, sizeAfterFirst);
  assert.equal(first.pruned, 0);
  assert.equal(second.pruned, 0);
});

test("syncProgressionEdges prunes edges no longer present in the static set", async () => {
  const stale: ProgressionEdgeInput = {
    fromId: "mos-word",
    toId: "byag",
    kind: PREREQUISITE_KIND,
  };
  const { writer, store } = fakeWriter([stale]);

  const result = await syncProgressionEdges(writer);

  assert.equal(result.pruned, 1);
  assert.equal(store.size, deriveEdgesFromStatic().length);
  assert.ok(
    ![...store.values()].some((e) => e.fromId === "mos-word" && e.toId === "byag"),
  );
});
