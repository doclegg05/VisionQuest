/**
 * Structural guard for the organization tree's RLS (migration
 * 20261107120000_org_tree_managed_student_ids).
 *
 * Coordinators read as the teacher RLS role. Two invariants keep that safe:
 *   1. every table with a teacher write branch has a RESTRICTIVE policy per
 *      write command that refuses tree readers (is_tree_reader);
 *   2. every transcript table has a RESTRICTIVE FOR ALL tree-reader block.
 *
 * A new migration that adds a teacher write branch without a block fails (1).
 * Generate the missing SQL with:
 *   node scripts/rls-teacher-branches.mjs --emit-write-blocks
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadMigrations,
  missingTreeReaderWriteBlocks,
  replayMigrations,
  teacherWriteTables,
} from "../../scripts/rls-teacher-branches.mjs";

/** Chat transcripts and text derived from them. Extend, never shrink, without a ruling. */
const TRANSCRIPT_TABLES = [
  "CareerDiscovery",
  "Conversation",
  "FailedExtraction",
  "FileUpload",
  "Message",
  "MoodEntry",
  "SageInsight",
  "SageMemory",
  "SageMemoryEdge",
  "SageOperation",
  "SagePanel",
  "StudentAlert",
  "WagerVerdict",
];

interface LivePolicy {
  table: string;
  mode: string;
  command: string;
  using: string | null;
  withCheck: string | null;
}

const live: Map<string, LivePolicy> = replayMigrations(loadMigrations(process.cwd()));

describe("tree-reader RLS coverage", () => {
  it("parses enough teacher write tables to mean something", () => {
    assert.ok(teacherWriteTables(live).length >= 50, "parser found too few tables; it is probably broken");
  });

  it("every table with a teacher write branch blocks tree-reader writes", () => {
    assert.deepEqual(missingTreeReaderWriteBlocks(live), []);
  });

  for (const table of TRANSCRIPT_TABLES) {
    it(`${table} has a RESTRICTIVE FOR ALL tree-reader block`, () => {
      const blocked = [...live.values()].some(
        (p) =>
          p.table === table &&
          p.mode === "restrictive" &&
          p.command === "ALL" &&
          /is_tree_reader/.test(p.using ?? "") &&
          /is_tree_reader/.test(p.withCheck ?? ""),
      );
      assert.ok(blocked, `${table} lost its tree-reader block`);
    });
  }
});
