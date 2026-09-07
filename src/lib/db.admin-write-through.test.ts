import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { isChatContextWrite } from "@/lib/chat-context-write-through";

/**
 * File-level invariant: a write through `prismaAdmin` to a model the chat
 * context caches must be accompanied by a hand-written cache invalidation.
 *
 * WHY THIS EXISTS. `prisma` in src/lib/db.ts is `.$extends(
 * chatContextWriteThroughExtension)`; `prismaAdmin` is the bare client and is
 * not. So a write through the admin client to any model in
 * STUDENT_SCOPED_MODEL_LIST / GLOBAL_MODEL_LIST / Conversation leaves Sage
 * serving the student's cached `chat:*` context for up to its TTL (180-600s) —
 * the exact staleness the write-through extension was built to end, reopened
 * one call site at a time. The doc block on `prismaAdmin` says so and asks for
 * a rule to catch it; this is that rule. Until now the comment was the only
 * enforcement, and on the day this was written it had already been missed:
 * `prismaAdmin.appointment.create` in src/lib/connect/employer-actions.ts, the
 * public employer booking page, left Sage telling the student they had nothing
 * scheduled for up to the TTL after an employer had booked a real interview
 * with them (fixed in the same commit as this file). One further site,
 * src/lib/advising-appointments.ts, is exempted with its reason in
 * db.admin-write-through.exemptions.json — it writes only two email-delivery
 * bookkeeping columns nothing cached reads.
 *
 * WHY A TEST RATHER THAN AN ESLINT SELECTOR. The invariant relates two
 * unrelated statements that may sit hundreds of lines apart in one file — a
 * write here, an invalidation there. `no-restricted-syntax` matches a node,
 * not a file. Same reasoning as src/lib/ai/audit-coverage.test.ts, which pins
 * the resolver/audit pairing the same way.
 *
 * THE WATCHED SET IS NEVER COPIED. It is derived by asking the production
 * predicate `isChatContextWrite()` about every model in `Prisma.ModelName`, so
 * a model added to or removed from either list in
 * src/lib/chat-context-write-through.ts changes what this test enforces on the
 * same commit, with nothing here to update.
 *
 * KNOWN LIMITS, deliberate and documented rather than papered over:
 *   1. File-level, not statement-level. A file that invalidates for one write
 *      and forgets a second one passes. The alternative (proving each write
 *      reaches an invalidation) needs dataflow analysis; this catches the case
 *      that has actually happened, which is a file with no invalidation at all.
 *   2. A watched write made through a client *passed into* a helper
 *      (`someHelper({ client: prismaAdmin })`) is invisible here, because the
 *      write lives in another file that never names `prismaAdmin`. Four such
 *      call sites exist today (employer-link.ts, employer-actions.ts ×3,
 *      replies.ts) and none of their helpers touch a watched model — checked by
 *      hand, and the reason this is a limit rather than a gap today.
 *   3. Raw SQL through the admin client (`prismaAdmin.$executeRaw`) carries no
 *      model name in its text, so it cannot be matched. The one instance in the
 *      repo — POST /api/internal/memory/consolidate, updating SageMemory —
 *      already calls `invalidateAllChatContext()` by hand and is the precedent
 *      this rule generalises.
 *
 * `ADMIN_WRITE_THROUGH_ROOT` lets the same check run against an exported tree,
 * so the red baseline is reproducible from any commit.
 */

const ROOT = path.resolve(process.env.ADMIN_WRITE_THROUGH_ROOT ?? process.cwd(), "src");
const EXEMPTIONS_PATH = path.join(ROOT, "lib/db.admin-write-through.exemptions.json");

/** Prisma model-level write operations, as named on a delegate. */
const WRITE_OPERATIONS = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
] as const;

const INVALIDATION_CALLS = ["invalidateChatContext(", "invalidateAllChatContext("];

/**
 * The models whose writes the chat context cares about — asked of the
 * production predicate, never transcribed. `"update"` is an arbitrary write
 * operation: `isChatContextWrite` gates on the operation only to reject reads.
 */
export function watchedModels(): string[] {
  return (Object.keys(Prisma.ModelName) as Prisma.ModelName[])
    .filter((model) => isChatContextWrite(model, "update"))
    .sort();
}

/** Prisma's delegate property for a model: `SageMemory` -> `sageMemory`. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function isTestPath(relative: string): boolean {
  return (
    relative.endsWith(".test.ts") ||
    relative.endsWith(".test.tsx") ||
    relative.split(path.sep).includes("__tests__")
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function loadExemptions(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8")) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Every name this file uses for the admin client: `prismaAdmin` itself, plus
 * any local alias introduced by an import (POST
 * /api/internal/memory/consolidate really does
 * `import { prismaAdmin as prisma }`, so an alias-blind matcher would miss the
 * very file the doc block cites as precedent).
 */
export function adminReceivers(source: string): string[] {
  const names = new Set<string>();
  if (/\bprismaAdmin\b/.test(source)) names.add("prismaAdmin");
  const aliasRe = /\bprismaAdmin\s+as\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(aliasRe)) names.add(match[1]);
  return [...names];
}

/**
 * Watched-model writes made through the admin client in one file: directly
 * (`prismaAdmin.appointment.create(`) and through the callback parameter of an
 * admin interactive transaction (`prismaAdmin.$transaction(async (tx) => {
 * tx.appointment.create(`). The array form of `$transaction` needs no special
 * case — its entries are `prismaAdmin.<model>.<write>(...)` expressions, which
 * the direct matcher already sees.
 */
export function findAdminWatchedWrites(source: string, watched: string[]): string[] {
  const receivers = adminReceivers(source);
  if (receivers.length === 0) return [];

  const delegates = watched.map(delegateName).join("|");
  const writes = WRITE_OPERATIONS.join("|");
  const escaped = receivers.map((name) => name.replace(/[$]/g, "\\$"));

  // Transaction callback parameter names, per admin receiver.
  const txParams = new Set<string>();
  for (const receiver of escaped) {
    const txRe = new RegExp(
      `${receiver}\\s*\\.\\s*\\$transaction\\s*\\(\\s*(?:async\\s*)?\\(?\\s*([A-Za-z_$][\\w$]*)`,
      "g",
    );
    for (const match of source.matchAll(txRe)) txParams.add(match[1]);
  }

  const holders = [...escaped, ...txParams];
  const hits = new Set<string>();
  for (const holder of holders) {
    const re = new RegExp(
      `\\b${holder}\\s*\\.\\s*(${delegates})\\s*\\.\\s*(${writes})\\s*\\(`,
      "g",
    );
    for (const match of source.matchAll(re)) hits.add(`${holder}.${match[1]}.${match[2]}`);
  }
  return [...hits].sort();
}

export interface AdminWriteOffender {
  file: string;
  writes: string[];
}

/** Files with an admin watched-model write and no invalidation call at all. */
export function findUninvalidatedAdminWrites(root = ROOT): AdminWriteOffender[] {
  const watched = watchedModels();
  const exemptions = loadExemptions();
  const offenders: AdminWriteOffender[] = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (isTestPath(relative)) continue;
    const source = readFileSync(file, "utf8");
    const writes = findAdminWatchedWrites(source, watched);
    if (writes.length === 0) continue;
    if (INVALIDATION_CALLS.some((call) => source.includes(call))) continue;
    // Exemption keys are repo-root-relative (`src/lib/...`), the path a reader
    // can paste straight into an editor.
    const key = `src/${relative}`;
    if (Object.hasOwn(exemptions, key)) continue;
    offenders.push({ file: key, writes });
  }
  return offenders.sort((a, b) => a.file.localeCompare(b.file));
}

describe("prismaAdmin chat-context write-through guard", () => {
  it("every prismaAdmin write to a watched model sits in a file that invalidates chat context", () => {
    const offenders = findUninvalidatedAdminWrites();
    assert.deepEqual(
      offenders,
      [],
      "These files write a chat-context-watched model through prismaAdmin (no write-through " +
        "extension) and never invalidate, so Sage serves stale context for up to the cache TTL:\n  " +
        offenders.map((o) => `${o.file} -> ${o.writes.join(", ")}`).join("\n  "),
    );
  });

  it("derives the watched set from the production predicate, and it is not empty", () => {
    // Guards against the whole check passing vacuously if the lists move or the
    // predicate changes shape: an empty watched set matches nothing, forever,
    // silently.
    const watched = watchedModels();
    assert.ok(watched.length >= 10, `expected at least 10 watched models, found ${watched.length}`);
    for (const model of ["Goal", "Appointment", "SageMemory", "Conversation", "CertTemplate"]) {
      assert.ok(watched.includes(model), `${model} should be a watched model`);
    }
    // A model deliberately NOT watched (chat-context-write-through.ts documents
    // why) must not creep in, or the guard would start demanding invalidation
    // for writes nothing caches.
    assert.ok(!watched.includes("Message"), "Message is deliberately not watched");
  });

  it("actually scans real source (guards against an empty glob passing vacuously)", () => {
    const watched = watchedModels();
    const withWrites = sourceFiles(ROOT).filter((file) => {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      if (isTestPath(relative)) return false;
      return findAdminWatchedWrites(readFileSync(file, "utf8"), watched).length > 0;
    });
    assert.ok(
      withWrites.length >= 1,
      "expected at least one prismaAdmin watched-model write in the tree; finding none means " +
        "the matcher stopped matching, not that the codebase stopped writing",
    );
  });

  describe("the matcher itself (shown to bite before it is trusted)", () => {
    const watched = watchedModels();

    it("matches a direct admin write", () => {
      const source = `import { prismaAdmin } from "@/lib/db";
        await prismaAdmin.appointment.create({ data: {} });`;
      assert.deepEqual(findAdminWatchedWrites(source, watched), [
        "prismaAdmin.appointment.create",
      ]);
    });

    it("matches a write through an aliased import", () => {
      // POST /api/internal/memory/consolidate imports it exactly this way.
      const source = `import { prismaAdmin as prisma } from "@/lib/db";
        await prisma.goal.updateMany({ where: {}, data: {} });`;
      assert.deepEqual(findAdminWatchedWrites(source, watched), ["prisma.goal.updateMany"]);
    });

    it("matches a write through an admin transaction callback parameter", () => {
      const source = `import { prismaAdmin } from "@/lib/db";
        await prismaAdmin.$transaction(async (tx) => {
          await tx.certification.upsert({ where: {}, create: {}, update: {} });
        });`;
      assert.deepEqual(findAdminWatchedWrites(source, watched), ["tx.certification.upsert"]);
    });

    it("ignores the app client, reads, and unwatched models", () => {
      const source = `import { prisma, prismaAdmin } from "@/lib/db";
        await prisma.appointment.update({ where: {}, data: {} });
        await prismaAdmin.appointment.findMany({});
        await prismaAdmin.message.create({ data: {} });`;
      assert.deepEqual(findAdminWatchedWrites(source, watched), []);
    });

    it("finds nothing in a file that never names the admin client", () => {
      const source = `import { prisma } from "@/lib/db";
        await prisma.goal.create({ data: {} });`;
      assert.deepEqual(findAdminWatchedWrites(source, watched), []);
    });
  });

  it("the exemption fixture carries a reason for every entry it lists", () => {
    const exemptions = loadExemptions();
    for (const [file, reason] of Object.entries(exemptions)) {
      assert.equal(typeof reason, "string", `${file} must carry a written reason`);
      assert.ok(
        reason.trim().length >= 40,
        `${file}'s exemption reason is too short to be a reason: ${JSON.stringify(reason)}`,
      );
    }
  });

  it("every exempted file still has the write it was exempted for", () => {
    // An allowlist entry that outlives its code is worse than no allowlist: it
    // sits there pre-forgiving whatever write lands in that file next. This
    // fails the moment an exemption stops describing something real.
    const watched = watchedModels();
    for (const file of Object.keys(loadExemptions())) {
      const full = path.resolve(process.env.ADMIN_WRITE_THROUGH_ROOT ?? process.cwd(), file);
      let source: string;
      try {
        source = readFileSync(full, "utf8");
      } catch {
        assert.fail(`exempted file ${file} does not exist — remove the exemption`);
      }
      assert.ok(
        findAdminWatchedWrites(source, watched).length > 0,
        `${file} is exempted but no longer makes an admin watched-model write — remove the exemption`,
      );
      assert.ok(
        !INVALIDATION_CALLS.some((call) => source.includes(call)),
        `${file} now invalidates chat context, so it does not need an exemption — remove it`,
      );
    }
  });
});
