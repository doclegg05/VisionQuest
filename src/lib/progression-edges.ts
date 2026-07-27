// =============================================================================
// Progression Edges
// Certification/platform prerequisite structure as data (issue #140).
// One ProgressionEdge row = "fromId depends on toId" (kind 'prerequisite'),
// seeded from the static CERTIFICATIONS arrays, which remain the seed source
// of truth for now. An empty table falls back to the static arrays so a fresh
// environment can never fail-open on pathway gating.
// =============================================================================

import { prisma } from "./db";
import { CERTIFICATIONS } from "./spokes/certifications";

export const PREREQUISITE_KIND = "prerequisite";

export interface ProgressionEdgeInput {
  fromId: string; // the dependent cert/platform id
  toId: string; // its prerequisite
  kind: string;
}

/** Structural client type so the seed sync is testable with a fake writer. */
export interface ProgressionEdgeWriter {
  progressionEdge: {
    upsert(args: {
      where: {
        fromId_toId_kind: { fromId: string; toId: string; kind: string };
      };
      update: Record<string, never>;
      create: ProgressionEdgeInput;
    }): Promise<unknown>;
    deleteMany(args: {
      where: {
        kind: string;
        NOT?: { OR: Array<{ fromId: string; toId: string }> };
      };
    }): Promise<{ count: number }>;
  };
}

/** Derive the edge set from the static arrays (the seed source of truth). */
export function deriveEdgesFromStatic(): ProgressionEdgeInput[] {
  const edges: ProgressionEdgeInput[] = [];
  for (const cert of CERTIFICATIONS) {
    for (const prereqId of cert.prerequisites) {
      edges.push({ fromId: cert.id, toId: prereqId, kind: PREREQUISITE_KIND });
    }
  }
  return edges;
}

/** Prerequisite map built purely from the static arrays. */
export function staticPrerequisiteMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of deriveEdgesFromStatic()) {
    map.set(edge.fromId, [...(map.get(edge.fromId) ?? []), edge.toId]);
  }
  return map;
}

/**
 * Load the prerequisite map from ProgressionEdge rows.
 *
 * Fail-safe: an empty table means the seed has not run in this environment —
 * fall back to the static arrays rather than silently unlocking every gated
 * step. (Render runs only `prisma:migrate:deploy` at start; the seed is a
 * separate manual step.)
 *
 * Ordering note: rows are ordered (fromId, toId) for determinism. For current
 * data this matches the static array order; prerequisites are consumed by
 * set-membership checks and display, so order is not load-bearing.
 */
export async function loadPrerequisiteMap(): Promise<Map<string, string[]>> {
  const rows = await prisma.progressionEdge.findMany({
    where: { kind: PREREQUISITE_KIND },
    select: { fromId: true, toId: true },
    orderBy: [{ fromId: "asc" }, { toId: "asc" }],
  });

  if (rows.length === 0) return staticPrerequisiteMap();

  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.fromId, [...(map.get(row.fromId) ?? []), row.toId]);
  }
  return map;
}

/**
 * Every transitive prerequisite of `id`: BFS over the prerequisite edges.
 * The visited set guards against cycles — the static data is acyclic today,
 * but future write paths (teacher-editable pathways) could introduce one,
 * and traversal must terminate regardless.
 */
export function collectTransitivePrerequisites(
  id: string,
  prereqMap: Map<string, string[]>,
): string[] {
  const visited = new Set<string>();
  const queue = [...(prereqMap.get(id) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || visited.has(next)) continue;
    visited.add(next);
    queue.push(...(prereqMap.get(next) ?? []));
  }

  return [...visited];
}

/**
 * "Are all transitive prerequisites of `id` complete?" — the traversal
 * helper delivered by issue #140. First production consumer is the future
 * teacher-editable pathway work; exercised by progression-edges.test.ts.
 */
export async function areTransitivePrerequisitesMet(
  id: string,
  completedIds: ReadonlySet<string>,
): Promise<boolean> {
  const map = await loadPrerequisiteMap();
  return collectTransitivePrerequisites(id, map).every((prereqId) =>
    completedIds.has(prereqId),
  );
}

/**
 * Idempotent seed sync: upsert every derived edge, then prune rows that are
 * no longer present in the static set. Safe because no other write path
 * exists for this table (teacher UI is an explicit non-goal of #140).
 * Called by scripts/seed-progression-edges.mjs.
 */
export async function syncProgressionEdges(
  client: ProgressionEdgeWriter,
): Promise<{ upserted: number; pruned: number }> {
  const edges = deriveEdgesFromStatic();

  for (const edge of edges) {
    await client.progressionEdge.upsert({
      where: {
        fromId_toId_kind: {
          fromId: edge.fromId,
          toId: edge.toId,
          kind: edge.kind,
        },
      },
      update: {},
      create: edge,
    });
  }

  // Guard the empty case explicitly: Prisma treats `OR: []` as matching
  // nothing, which would flip NOT into matching everything anyway — but the
  // intent (mirror the static set exactly) deserves to be unambiguous.
  const pairs = edges.map(({ fromId, toId }) => ({ fromId, toId }));
  const { count } = await client.progressionEdge.deleteMany({
    where:
      pairs.length > 0
        ? { kind: PREREQUISITE_KIND, NOT: { OR: pairs } }
        : { kind: PREREQUISITE_KIND },
  });

  return { upserted: edges.length, pruned: count };
}
