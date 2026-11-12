/**
 * The alert actions against a real Postgres (readiness C11).
 *
 * route.test.ts proves the rules over an in-memory row. What only a database can show is that the timestamp a resolve
 * answers with, sent back by the queue's Undo, still equals the stored `resolvedAt` once Postgres has rounded it to
 * its column precision, so a fresh Undo matches and reopens, while an Undo naming another moment matches nothing.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated, NON-PRODUCTION Postgres.
 *   - ALERT_ACTIONS_DB_TEST_ENABLED=true. Opt-in because the test writes a real Student and StudentAlert (it removes
 *     its own afterwards).
 *
 * Typical usage:
 *   ALERT_ACTIONS_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     node --import tsx --test src/lib/teacher/alert-actions.db.test.ts
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

const SHOULD_RUN = process.env.ALERT_ACTIONS_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

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
    let prismaAdmin: typeof import("../db").prismaAdmin;
    let target: { id: string; studentId: string };

    before(async () => {
      actions = await import("./alert-actions");
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
