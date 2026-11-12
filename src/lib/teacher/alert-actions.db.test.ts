/**
 * The alert actions against a real Postgres (readiness C11).
 *
 * route.test.ts proves the rules over an in-memory row. What only a database can show is that the timestamp a resolve
 * answers with, sent back by the queue's Undo, still equals the stored `resolvedAt` once Postgres has rounded it to
 * its column precision, so a fresh Undo matches and reopens, while an Undo naming another moment matches nothing.
 *
 * It also shows the alert sync keeping a dismiss that commits between the sync's read of the alerts and its writes.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL (and ADMIN_DATABASE_URL, if set) point at a migrated, NON-PRODUCTION Postgres on this machine. The
 *     test refuses any other host, because a worktree's `.env.local` can point at production.
 *   - ALERT_ACTIONS_DB_TEST_ENABLED=true. Opt-in because the test writes a real Student and StudentAlert (it removes
 *     its own afterwards).
 *
 * Typical usage:
 *   ALERT_ACTIONS_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     node --import tsx --test src/lib/teacher/alert-actions.db.test.ts
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

const SHOULD_RUN = process.env.ALERT_ACTIONS_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for a URL whose host is this machine and that names no other host in its query (as closeout.db.test.ts). */
function isLocalDatabase(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return LOCAL_HOSTS.has(url.hostname) && !url.searchParams.has("host");
  } catch {
    return false;
  }
}

/** Prefix every fixture row shares, so cleanup is exact. */
const PREFIX = "alert-actions-db-test";
const ACTOR = `${PREFIX}-teacher`;

if (!SHOULD_RUN) {
  describe("alert actions against Postgres (integration), SKIPPED", () => {
    it("requires ALERT_ACTIONS_DB_TEST_ENABLED=true and DATABASE_URL", () => {
      assert.ok(true, "Set ALERT_ACTIONS_DB_TEST_ENABLED=true and point DATABASE_URL at a non-production, migrated database.");
    });
  });
} else {
  describe("alert actions against Postgres (integration)", () => {
    let actions: typeof import("./alert-actions");
    let sync: typeof import("../advising-sync");
    let prismaAdmin: typeof import("../db").prismaAdmin;
    let target: { id: string; studentId: string };

    before(async () => {
      // Checked before ../db is imported, so no client ever connects to another host.
      assert.ok(isLocalDatabase(process.env.DATABASE_URL ?? ""), "DATABASE_URL must point at a database on this machine.");
      const adminUrl = process.env.ADMIN_DATABASE_URL;
      assert.ok(!adminUrl || isLocalDatabase(adminUrl), "ADMIN_DATABASE_URL must point at a database on this machine.");
      // "server-only" throws at import time outside a Next.js server build; the sync imports it.
      mock.module("server-only", { namedExports: {} });
      actions = await import("./alert-actions");
      sync = await import("../advising-sync");
      ({ prismaAdmin } = await import("../db"));
    });

    // The alert goes with its student (onDelete: Cascade).
    const cleanup = () => prismaAdmin.student.deleteMany({ where: { studentId: { startsWith: PREFIX } } });

    beforeEach(async () => {
      await cleanup();
      const student = await prismaAdmin.student.create({
        data: { studentId: `${PREFIX}-student`, displayName: "Alert Test" },
        select: { id: true },
      });
      target = await prismaAdmin.studentAlert.create({
        data: {
          studentId: student.id,
          alertKey: `${PREFIX}:${student.id}`,
          type: "certification_stalled",
          title: "Certification progress stalled",
          summary: "No progress in 14 days.",
        },
        select: { id: true, studentId: true },
      });
    });

    after(async () => {
      await cleanup();
      await prismaAdmin.$disconnect();
    });

    // A timestamp with sub-millisecond detail would not round trip; the app's Date never has any, and this pins it.
    it("reopens with the exact timestamp the resolve answered with", async () => {
      const resolved = await actions.applyAlertAction(target, { action: "resolve" }, ACTOR, new Date());
      assert.equal(resolved.kind, "changed");
      assert.ok(resolved.kind === "changed" && resolved.response.status === "resolved");
      const at = resolved.response.resolvedAt;

      const stored = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.resolvedAt?.toISOString(), at, "the stored stamp equals the answer's");

      const reopened = await actions.applyAlertAction(
        target,
        { action: "reopen", expected: { status: "resolved", at } },
        ACTOR,
        new Date(),
      );
      assert.deepEqual(reopened, { kind: "changed", response: { status: "open" } });
      const after = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.status, "open");
      assert.equal(after.resolvedAt, null);
    });

    it("refuses an Undo whose timestamp is a millisecond off, and changes nothing", async () => {
      const resolved = await actions.applyAlertAction(target, { action: "resolve" }, ACTOR, new Date());
      assert.ok(resolved.kind === "changed" && resolved.response.status === "resolved");
      const off = new Date(new Date(resolved.response.resolvedAt).getTime() + 1).toISOString();

      const refused = await actions.applyAlertAction(
        target,
        { action: "reopen", expected: { status: "resolved", at: off } },
        ACTOR,
        new Date(),
      );
      assert.deepEqual(refused, { kind: "conflict" });
      const stored = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.status, "resolved");
      assert.equal(stored.resolvedAt?.toISOString(), resolved.response.resolvedAt);
    });

    it("reopens a dismiss with the exact timestamp the dismiss answered with", async () => {
      const dismissed = await actions.applyAlertAction(target, { action: "dismiss" }, ACTOR, new Date());
      assert.ok(dismissed.kind === "changed" && dismissed.response.status === "dismissed");
      const at = dismissed.response.dismissedAt;

      const stored = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.dismissedAt?.toISOString(), at, "the stored stamp equals the answer's");

      const reopened = await actions.applyAlertAction(
        target,
        { action: "reopen", expected: { status: "dismissed", at } },
        ACTOR,
        new Date(),
      );
      assert.deepEqual(reopened, { kind: "changed", response: { status: "open" } });
      const after = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.status, "open");
      assert.equal(after.dismissedAt, null);
    });

    // The sync reads the alerts before its transaction (loadStudentAlertSyncContext). A dismiss that commits after
    // that read must survive the sync's writes, which Postgres re-checks against the latest committed row.
    it("keeps a dismiss that commits between the sync's read and its writes", async () => {
      const existing = await prismaAdmin.studentAlert.findMany({
        where: { studentId: target.studentId, status: { in: ["open", "snoozed", "dismissed"] } },
        select: { id: true, alertKey: true, status: true, snoozedUntil: true },
      });
      assert.equal(existing.length, 1);
      assert.equal(existing[0].status, "open");

      const dismissed = await actions.applyAlertAction(target, { action: "dismiss" }, ACTOR, new Date());
      assert.ok(dismissed.kind === "changed" && dismissed.response.status === "dismissed");

      const desired = {
        alertKey: existing[0].alertKey,
        type: "certification_stalled",
        severity: "high",
        title: "Certification progress stalled",
        summary: "No progress in 35 days.",
        sourceType: "certification",
        sourceId: target.studentId,
      };
      await sync.applyStudentAlertSyncPlan({ studentId: target.studentId, now: new Date(), existing, desiredAlerts: [desired] });

      const stored = await prismaAdmin.studentAlert.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.status, "dismissed");
      assert.equal(stored.dismissedAt?.toISOString(), dismissed.response.dismissedAt);
      assert.equal(stored.summary, desired.summary, "the text is still refreshed");
    });

    it("answers a second dismiss as already saved, so no Undo is offered for it", async () => {
      const first = await actions.applyAlertAction(target, { action: "dismiss" }, ACTOR, new Date());
      const second = await actions.applyAlertAction(target, { action: "dismiss" }, `${ACTOR}-b`, new Date());
      assert.equal(second.kind, "unchanged");
      assert.ok(first.kind === "changed" && first.response.status === "dismissed");
      assert.ok(second.kind === "unchanged" && second.response.status === "dismissed");
      assert.equal(second.response.dismissedAt, first.response.dismissedAt);
      assert.equal(second.response.alreadySaved, true);
    });
  });
}
