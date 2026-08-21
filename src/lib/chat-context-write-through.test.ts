import assert from "node:assert/strict";
import test from "node:test";
import { cached } from "./cache";
import {
  applyChatContextWriteThrough,
  isChatContextWrite,
  resolveChatContextInvalidation,
} from "./chat-context-write-through";

// ---------------------------------------------------------------------------
// resolveChatContextInvalidation — pure resolver mapping a Prisma write
// (model, operation, args, result) to a chat-context invalidation scope.
//
// The first block maps ONE-TO-ONE to the Group B cases of
// scripts/sage-freshness-eval.mjs: each case's exact write shape must resolve
// to the student whose context it changes.
// ---------------------------------------------------------------------------

const SID = "student-cuid-1";
const OTHER_SID = "student-cuid-2";

test("B1/B6 — goal create (data.studentId) resolves to the student", () => {
  const res = resolveChatContextInvalidation("Goal", "create", {
    data: { studentId: SID, level: "monthly", content: "x", status: "active" },
  }, { id: "g1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("B2 — orientation progress upsert (compound where studentId_itemId) resolves to the student", () => {
  const res = resolveChatContextInvalidation("OrientationProgress", "upsert", {
    where: { studentId_itemId: { studentId: SID, itemId: "item-1" } },
    update: { completed: true },
    create: { studentId: SID, itemId: "item-1", completed: true },
  }, { id: "op1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("B3 — career discovery update (where.studentId unique) resolves to the student", () => {
  const res = resolveChatContextInvalidation("CareerDiscovery", "update", {
    where: { studentId: SID },
    data: { sageSummary: "new interest" },
  }, { id: "cd1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("B4 — form submission upsert (compound where studentId_formId) resolves to the student", () => {
  const res = resolveChatContextInvalidation("FormSubmission", "upsert", {
    where: { studentId_formId: { studentId: SID, formId: "form-1" } },
    create: { studentId: SID, formId: "form-1", fileId: "f", status: "pending" },
    update: { status: "pending" },
  }, { id: "fs1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("B5 — appointment create resolves to the student", () => {
  const res = resolveChatContextInvalidation("Appointment", "create", {
    data: { studentId: SID, advisorId: "t1", title: "review", status: "scheduled" },
  }, { id: "a1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

// ---------------------------------------------------------------------------
// Write paths beyond the eval (routes/helpers the grep sweep found).
// ---------------------------------------------------------------------------

test("goal update by id (teacher confirm, agent write-tool) resolves via the returned row", () => {
  const res = resolveChatContextInvalidation("Goal", "update", {
    where: { id: "g1" },
    data: { status: "confirmed" },
  }, { id: "g1", studentId: SID, status: "confirmed" });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("goal update whose select drops studentId falls back to all (never stale)", () => {
  const res = resolveChatContextInvalidation("Goal", "update", {
    where: { id: "g1" },
    data: { status: "abandoned" },
    select: { id: true },
  }, { id: "g1" });
  assert.deepEqual(res, { scope: "all" });
});

test("goal updateMany with a plain-string where.studentId resolves to the student", () => {
  const res = resolveChatContextInvalidation("Goal", "updateMany", {
    where: { studentId: SID, status: "active" },
    data: { status: "abandoned" },
  }, { count: 2 });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("goal updateMany with a filter-object where.studentId falls back to all", () => {
  const res = resolveChatContextInvalidation("Goal", "updateMany", {
    where: { studentId: { in: [SID, OTHER_SID] } },
    data: { status: "abandoned" },
  }, { count: 2 });
  assert.deepEqual(res, { scope: "all" });
});

test("goal createMany collects every distinct studentId", () => {
  const res = resolveChatContextInvalidation("Goal", "createMany", {
    data: [
      { studentId: SID, level: "daily", content: "a", status: "active" },
      { studentId: OTHER_SID, level: "daily", content: "b", status: "active" },
      { studentId: SID, level: "weekly", content: "c", status: "active" },
    ],
  }, { count: 3 });
  assert.equal(res.scope, "students");
  assert.deepEqual([...(res.scope === "students" ? res.studentIds : [])].sort(), [SID, OTHER_SID].sort());
});

test("certification create resolves to the student", () => {
  const res = resolveChatContextInvalidation("Certification", "create", {
    data: { studentId: SID, certType: "ready-to-work" },
  }, { id: "c1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("certRequirement updateMany (no studentId anywhere) falls back to all", () => {
  const res = resolveChatContextInvalidation("CertRequirement", "updateMany", {
    where: { certificationId: "c1" },
    data: { completed: true },
  }, { count: 4 });
  assert.deepEqual(res, { scope: "all" });
});

test("orientation item writes are global (change every student's totals)", () => {
  const res = resolveChatContextInvalidation("OrientationItem", "create", {
    data: { label: "New step", required: true, sortOrder: 10 },
  }, { id: "i1" });
  assert.deepEqual(res, { scope: "all" });
});

test("cert template createMany is global", () => {
  const res = resolveChatContextInvalidation("CertTemplate", "createMany", {
    data: [{ certType: "ready-to-work", label: "t", required: true }],
  }, { count: 1 });
  assert.deepEqual(res, { scope: "all" });
});

test("sage insight create resolves to the student", () => {
  const res = resolveChatContextInvalidation("SageInsight", "create", {
    data: { studentId: SID, category: "context", content: "x" },
  }, { id: "si1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("sage memory create (extract store path) resolves to the student", () => {
  const res = resolveChatContextInvalidation("SageMemory", "create", {
    data: { studentId: SID, content: "prefers mornings" },
  }, { id: "sm1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("resume data upsert resolves to the student (career-thread key)", () => {
  const res = resolveChatContextInvalidation("ResumeData", "upsert", {
    where: { studentId: SID },
    create: { studentId: SID },
    update: {},
  }, { id: "r1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("conversation stage/title updates resolve to none (per-turn writes must not defeat the cache)", () => {
  for (const data of [{ stage: "onboarding" }, { title: "First chat..." }, { active: false }]) {
    const res = resolveChatContextInvalidation("Conversation", "update", {
      where: { id: "conv1" },
      data,
    }, { id: "conv1", studentId: SID });
    assert.deepEqual(res, { scope: "none" }, `data=${JSON.stringify(data)}`);
  }
});

test("conversation summary write resolves to the student (prior-conversation context)", () => {
  const res = resolveChatContextInvalidation("Conversation", "update", {
    where: { id: "conv1" },
    data: { summary: "We planned the week.", summaryUpToMessageId: "m9" },
  }, { id: "conv1", studentId: SID });
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

// Progression IS watched: getSituationalSnapshot caches the rendered
// `Level N, X XP` line under chat:snapshot for 180s, so an XP award that
// does not invalidate leaves Sage quoting the student's old level back at
// them. updateProgression writes through the extended client as
// `updateMany({ where: { studentId, version } })` — the real shape below.
test("progression updateMany invalidates the student (XP/level are cached in chat:snapshot)", () => {
  const res = resolveChatContextInvalidation(
    "Progression",
    "updateMany",
    { where: { studentId: SID, version: 3 }, data: { state: "{}", version: 4 } },
    { count: 1 },
  );
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

test("progression upsert invalidates the student", () => {
  const res = resolveChatContextInvalidation(
    "Progression",
    "upsert",
    { where: { studentId: SID }, create: { studentId: SID, state: "{}" }, update: { state: "{}" } },
    { id: "p1", studentId: SID },
  );
  assert.deepEqual(res, { scope: "students", studentIds: [SID] });
});

// Message/ProgressionEvent/Student stay unwatched on their original
// reasoning: they are written on essentially every turn and the surfaces
// they feed (message count, recentEvents in the bundle) are genuinely read
// uncached. Progression was removed from this list because that second
// claim was false for it — see the two tests above.
test("unwatched models resolve to none (Message, ProgressionEvent, Student)", () => {
  for (const model of ["Message", "ProgressionEvent", "Student"]) {
    const res = resolveChatContextInvalidation(model, "create", { data: { studentId: SID } }, { id: "x" });
    assert.deepEqual(res, { scope: "none" }, model);
  }
});

test("read operations resolve to none even on watched models", () => {
  for (const op of ["findMany", "findUnique", "findFirst", "count", "aggregate", "groupBy"]) {
    const res = resolveChatContextInvalidation("Goal", op, { where: { studentId: SID } }, []);
    assert.deepEqual(res, { scope: "none" }, op);
  }
});

test("raw operations (model undefined) resolve to none", () => {
  const res = resolveChatContextInvalidation(undefined, "$executeRaw", {}, 1);
  assert.deepEqual(res, { scope: "none" });
});

test("delete resolves via the returned row; deleteMany without studentId falls back to all", () => {
  const del = resolveChatContextInvalidation("Appointment", "delete", {
    where: { id: "a1" },
  }, { id: "a1", studentId: SID });
  assert.deepEqual(del, { scope: "students", studentIds: [SID] });

  const delMany = resolveChatContextInvalidation("OrientationProgress", "deleteMany", {
    where: { itemId: "i1" },
  }, { count: 3 });
  assert.deepEqual(delMany, { scope: "all" });
});

// ---------------------------------------------------------------------------
// isChatContextWrite — the cheap gate db.ts consults before paying anything.
// ---------------------------------------------------------------------------

test("isChatContextWrite is true only for write ops on watched models", () => {
  assert.equal(isChatContextWrite("Goal", "create"), true);
  assert.equal(isChatContextWrite("Conversation", "update"), true);
  assert.equal(isChatContextWrite("Goal", "findMany"), false);
  assert.equal(isChatContextWrite("Message", "create"), false);
  assert.equal(isChatContextWrite(undefined, "$queryRaw"), false);
});

// ---------------------------------------------------------------------------
// applyChatContextWriteThrough — the fire-safe shell: it must actually clear
// the cached chat context, and a bad payload must never throw (a cache
// invalidation failure must not fail the write).
// ---------------------------------------------------------------------------

test("applyChatContextWriteThrough clears the student's cached chat context", async () => {
  const key = `chat:snapshot:${SID}`;
  await cached(key, 60, async () => "warm snapshot");
  const otherKey = `chat:snapshot:${OTHER_SID}`;
  await cached(otherKey, 60, async () => "other snapshot");

  applyChatContextWriteThrough("Goal", "create", { data: { studentId: SID } }, { id: "g", studentId: SID });

  let recomputed = false;
  const after = await cached(key, 60, async () => {
    recomputed = true;
    return "fresh snapshot";
  });
  assert.equal(recomputed, true, "target student's snapshot should have been invalidated");
  assert.equal(after, "fresh snapshot");

  let otherRecomputed = false;
  await cached(otherKey, 60, async () => {
    otherRecomputed = true;
    return "?";
  });
  assert.equal(otherRecomputed, false, "other student's snapshot must survive");
});

test("applyChatContextWriteThrough never throws, even on garbage payloads", () => {
  assert.doesNotThrow(() => applyChatContextWriteThrough("Goal", "update", null, undefined));
  assert.doesNotThrow(() => applyChatContextWriteThrough("Goal", "updateMany", 42, "nonsense"));
  assert.doesNotThrow(() =>
    applyChatContextWriteThrough("Conversation", "update", { data: { summary: 7 } }, { studentId: 9 }),
  );
});
