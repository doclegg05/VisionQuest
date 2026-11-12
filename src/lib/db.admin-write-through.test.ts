import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";
import ts from "typescript";

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
  const re = adminWriteRegex(source, watched);
  if (!re) return [];
  const hits = new Set<string>();
  for (const match of source.matchAll(re)) hits.add(`${match[1]}.${match[2]}.${match[3]}`);
  return [...hits].sort();
}

/**
 * One regex for `<holder>.<watched delegate>.<write>(`, where a holder is the
 * admin client, an alias of it, or an admin transaction's callback parameter.
 * Null when the file never names the admin client.
 */
function adminWriteRegex(source: string, watched: string[], flags = "g"): RegExp | null {
  const receivers = adminReceivers(source);
  if (receivers.length === 0) return null;

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

  const holders = [...escaped, ...txParams].join("|");
  return new RegExp(`\\b(${holders})\\s*\\.\\s*(${delegates})\\s*\\.\\s*(${writes})\\s*\\(`, flags);
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

// ---------------------------------------------------------------------------
// Function level: every exit after a watched admin write passes a clear.
//
// The file-level rule above let src/lib/intake/provision.ts through: its
// new-student path cleared, so the file "invalidated", while its
// existing-student path wrote an enrollment and returned with no clear. This
// check closes that case with the TypeScript parser. Within one function, each
// exit (a `return`, or falling off the end) that comes after a watched admin
// write must have a clear call between the last such write and the exit.
//
// What counts as one function: a callback passed straight into a call
// (`prismaAdmin.$transaction(async (tx) => ...)`, `.map(async (row) => ...)`)
// is part of the function that makes the call, and its own `return`s are not
// exits. Any other function is its own scope.
//
// Two shapes hand the clear to someone else, and are not reported:
//   - A helper called by name from another function in the same file (a
//     transaction body, a helper taking `tx`). Its callers are checked
//     instead, with each call to it counting as a write.
//   - A `return` in the `catch` of a `try` whose writes all sit inside a
//     `$transaction` there: the throw rolled them back.
//
// Still approximate, on purpose: "between" is source order, not control flow,
// so a clear in one branch also covers a later return in a sibling branch.
// That can only miss a gap, never invent one. A helper with no caller in its
// own file is checked on its own, so an exported helper must clear itself.
// Writes through a client passed into another file and raw SQL stay out of
// reach, as in KNOWN LIMITS above.
// ---------------------------------------------------------------------------

type FunctionWithBody = ts.FunctionLikeDeclaration & { body: ts.ConciseBody };

function hasBody(node: ts.Node): node is FunctionWithBody {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

/** A function whose returns leave to a caller: not a callback passed straight into a call. */
function isOwnScope(node: ts.Node): node is FunctionWithBody {
  if (!hasBody(node)) return false;
  return !(ts.isCallExpression(node.parent) && node.parent.arguments.some((arg) => arg === node));
}

/** The nearest function around a node, transparent or not. */
function ownFunctionOf(node: ts.Node): ts.Node | null {
  for (let current = node.parent; current; current = current.parent) if (hasBody(current)) return current;
  return null;
}

/** The function whose exits a node's code reaches: callbacks passed into a call are transparent. */
function exitScopeOf(node: ts.Node): FunctionWithBody | null {
  for (let current = node.parent; current; current = current.parent) if (isOwnScope(current)) return current;
  return null;
}

/** The name a same-file caller would use: `function f`, `const f = () =>`, a method. */
function scopeName(scope: FunctionWithBody): string | null {
  if (scope.name && ts.isIdentifier(scope.name)) return scope.name.text;
  const parent = scope.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
}

interface Event { readonly node: ts.Node; readonly text: string }

interface ScopeEvents {
  readonly name: string | null;
  readonly writes: Event[];
  readonly calls: Event[];
  readonly clears: ts.Node[];
  readonly exits: ts.Node[];
}

function bodyEndIsReachable(body: ts.Node): boolean {
  if (!ts.isBlock(body)) return true;
  const last = body.statements.at(-1);
  return !last || !(ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

function recordCall(events: ScopeEvents, node: ts.CallExpression, sf: ts.SourceFile, write: RegExp): void {
  const callee = node.expression.getText(sf).replace(/\s+/g, "");
  if (write.test(`${callee}(`)) events.writes.push({ node, text: callee });
  else if (INVALIDATION_CALLS.includes(`${callee}(`)) events.clears.push(node);
  else if (ts.isIdentifier(node.expression)) events.calls.push({ node, text: callee });
}

function collectScopeEvents(sf: ts.SourceFile, write: RegExp): Map<ts.Node, ScopeEvents> {
  const scopes = new Map<ts.Node, ScopeEvents>();
  const eventsOf = (scope: FunctionWithBody): ScopeEvents => {
    const found = scopes.get(scope) ?? { name: scopeName(scope), writes: [], calls: [], clears: [], exits: [] };
    scopes.set(scope, found);
    return found;
  };
  const visit = (node: ts.Node): void => {
    const scope = exitScopeOf(node);
    if (scope && ts.isCallExpression(node)) recordCall(eventsOf(scope), node, sf, write);
    // A callback's own return hands a value back to the call, not to a caller.
    if (scope && ts.isReturnStatement(node) && ownFunctionOf(node) === scope) eventsOf(scope).exits.push(node);
    if (isOwnScope(node) && bodyEndIsReachable(node.body)) eventsOf(node).exits.push(node.body);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return scopes;
}

function isInside(node: ts.Node, ancestor: ts.Node): boolean {
  return node.getStart() >= ancestor.getStart() && node.getEnd() <= ancestor.getEnd();
}

/** Inside a `$transaction(...)` call that sits inside `block`. */
function inTransactionWithin(node: ts.Node, block: ts.Node): boolean {
  for (let current = node.parent; current && current !== block; current = current.parent) {
    if (ts.isCallExpression(current) && /\.\$transaction$/.test(current.expression.getText().replace(/\s+/g, ""))) return true;
  }
  return false;
}

/** Writes an exit's catch clause rolled back: in a `$transaction` inside the matching `try`. */
function rolledBackBy(exit: ts.Node, writes: readonly Event[]): readonly Event[] {
  for (let current = exit.parent; current; current = current.parent) {
    if (hasBody(current)) return writes;
    if (!ts.isCatchClause(current)) continue;
    const tryBlock = current.parent.tryBlock;
    return writes.filter((w) => !(isInside(w.node, tryBlock) && inTransactionWithin(w.node, tryBlock)));
  }
  return writes;
}

/** The exits that leave after a write (or a call to a same-file writer) with no clear in between. */
function unclearedExits(events: ScopeEvents, writers: ReadonlySet<string>): { exit: ts.Node; write: Event }[] {
  const writes = [...events.writes, ...events.calls.filter((call) => writers.has(call.text))];
  const out: { exit: ts.Node; write: Event }[] = [];
  for (const exit of events.exits) {
    const before = rolledBackBy(exit, writes).filter((w) => w.node.getEnd() <= exit.getEnd());
    if (before.length === 0) continue;
    const last = before.reduce((a, b) => (b.node.getEnd() > a.node.getEnd() ? b : a));
    const cleared = events.clears.some((c) => c.getStart() > last.node.getEnd() && c.getStart() < exit.getEnd());
    if (!cleared) out.push({ exit, write: last });
  }
  return out;
}

/** Same-file helpers that leave a write uncleared but are called by another function here. */
function deferredWriters(scopes: readonly ScopeEvents[]): Set<string> {
  const writers = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const events of scopes) {
      if (!events.name || writers.has(events.name) || unclearedExits(events, writers).length === 0) continue;
      const calledHere = scopes.some((other) => other !== events && other.calls.some((call) => call.text === events.name));
      if (calledHere) { writers.add(events.name); grew = true; }
    }
  }
  return writers;
}

/** `file:line` of each exit that leaves after a watched admin write with no clear in between. */
export function findUnclearedAdminExits(source: string, watched: string[], fileName = "source.ts"): string[] {
  const pattern = adminWriteRegex(source, watched, "");
  if (!pattern) return [];
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const scopes = [...collectScopeEvents(sf, new RegExp(`^${pattern.source}$`)).values()];
  const writers = deferredWriters(scopes);
  const lineOf = (node: ts.Node, end = false) => sf.getLineAndCharacterOfPosition(end ? node.getEnd() : node.getStart()).line + 1;
  return scopes
    .filter((events) => !(events.name && writers.has(events.name)))
    .flatMap((events) => unclearedExits(events, writers))
    .map(({ exit, write }) => `${fileName}:${lineOf(exit, true)} exits after ${write.text} (line ${lineOf(write.node)}) with no clear`);
}

/** Every uncleared exit in the tree, skipping exempted files. */
export function findUnclearedAdminExitsInTree(root = ROOT): string[] {
  const watched = watchedModels();
  const exemptions = loadExemptions();
  const offenders: string[] = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (isTestPath(relative) || Object.hasOwn(exemptions, `src/${relative}`)) continue;
    offenders.push(...findUnclearedAdminExits(readFileSync(file, "utf8"), watched, `src/${relative}`));
  }
  return offenders.sort();
}

describe("prismaAdmin write-through guard, per function exit", () => {
  const watched = watchedModels();

  it("every exit after a watched prismaAdmin write passes a clear first", () => {
    const offenders = findUnclearedAdminExitsInTree();
    assert.deepEqual(offenders, [], "Clear the student's chat context before these exits:\n  " + offenders.join("\n  "));
  });

  it("flags a branch that writes and returns without the clear another branch makes", () => {
    // The shape of the provision.ts gap: the existing-student branch wrote an
    // enrollment and returned; only the new-student branch cleared.
    const source = `import { prismaAdmin as prisma } from "@/lib/db";
      export async function provision(existing: string | null) {
        if (existing) {
          await prisma.studentClassEnrollment.create({ data: {} });
          return "updated";
        }
        await prisma.$transaction(async (tx) => {
          await tx.orientationProgress.createMany({ data: [] });
          return 1;
        });
        invalidateChatContext("s1");
        return "provisioned";
      }`;
    const offenders = findUnclearedAdminExits(source, watched);
    assert.equal(offenders.length, 1, offenders.join("\n"));
    assert.match(offenders[0], /:5 exits after prisma\.studentClassEnrollment\.create/);
  });

  it("accepts a clear between the write and the exit, and a transaction callback's own return", () => {
    const source = `import { prismaAdmin } from "@/lib/db";
      export async function save() {
        await prismaAdmin.$transaction(async (tx) => {
          await tx.goal.update({ where: {}, data: {} });
          return 1;
        });
        invalidateAllChatContext();
      }`;
    assert.deepEqual(findUnclearedAdminExits(source, watched), []);
  });

  it("flags falling off the end, and a write returned straight to the caller", () => {
    const source = `import { prismaAdmin } from "@/lib/db";
      async function a() { await prismaAdmin.goal.update({ where: {}, data: {} }); }
      async function b() { invalidateChatContext("s"); return prismaAdmin.goal.delete({ where: {} }); }`;
    assert.equal(findUnclearedAdminExits(source, watched).length, 2);
  });

  it("checks a same-file helper's callers instead of the helper, and still flags a caller that forgets", () => {
    const source = `import { prismaAdmin } from "@/lib/db";
      function insert(tx) { return tx.goal.create({ data: {} }); }
      async function writeAll() { return prismaAdmin.$transaction(async (tx) => insert(tx)); }
      export async function good() { await writeAll(); invalidateChatContext("s"); }
      export async function bad() { await writeAll(); return "done"; }`;
    const offenders = findUnclearedAdminExits(source, watched);
    assert.equal(offenders.length, 1, offenders.join("\n"));
    assert.match(offenders[0], /:5 exits after writeAll/);
  });

  it("lets a catch return out of a rolled-back transaction, but not out of a plain write", () => {
    const source = `import { prismaAdmin } from "@/lib/db";
      export async function a() {
        try { await prismaAdmin.$transaction(async (tx) => tx.goal.create({ data: {} })); }
        catch { return; }
        invalidateChatContext("s");
      }
      export async function b() {
        try { await prismaAdmin.goal.create({ data: {} }); await later(); }
        catch { return; }
        invalidateChatContext("s");
      }`;
    const offenders = findUnclearedAdminExits(source, watched);
    assert.equal(offenders.length, 1, offenders.join("\n"));
    assert.match(offenders[0], /:9 exits after prismaAdmin\.goal\.create/);
  });
});

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
    assert.ok(!watched.includes("ProgressionEvent"), "ProgressionEvent is deliberately not watched");
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
        await prismaAdmin.progressionEvent.create({ data: {} });`;
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
