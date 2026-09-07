-- VQ-R-018 (2026-09-07 career/job-search fluidity memo): "JobListing.sourceId"
-- was a bare, program-wide unique key, and the scrape upsert
-- (scrape-engine.ts) keyed on it alone. Two classes whose regions both
-- surface the same national posting (a USAJobs/Greenhouse/Lever listing,
-- say) collided: the second class's overnight refresh reassigned that row's
-- classConfigId, silently vanishing it from the first class's board.
--
-- This scopes the uniqueness to (classConfigId, sourceId) instead, mirroring
-- JobBrowseListing's existing "@@unique([source, sourceId])" pattern. It is
-- additive-plus-one-drop: no columns added or removed, no data rewritten,
-- no rows deleted.
--
-- PROD PRE-CHECK REQUIRED BEFORE THIS MIGRATION IS DEPLOYED (memo §5.3): a
-- global-unique key cannot have had duplicate (source, sourceId) pairs
-- while it was in force, so this migration cannot itself fail on existing
-- data — but it also cannot recover whichever class's copy of a shared
-- posting a prior scrape already silently overwrote. Run this in the
-- Supabase SQL editor first to see whether any collisions have already
-- happened (a count > 1 here happened under the OLD schema, keyed only by
-- source+sourceId, since JobListing has no class-scoped notion until this
-- migration applies):
--
--   SELECT source, "sourceId", count(*)
--   FROM visionquest."JobListing"
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
--
-- Under the old bare-unique constraint this can only ever return zero rows
-- today (duplicates were structurally impossible pre-migration) — it is a
-- sanity check on the constraint itself, not a collision finder. The real
-- prod-drift question the memo flags is unanswerable from the DB alone: a
-- silently reassigned row leaves no trace of which class lost it, which is
-- exactly the bug this migration closes going forward.

-- DropIndex
DROP INDEX "visionquest"."JobListing_sourceId_key";

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_classConfigId_sourceId_key" ON "visionquest"."JobListing"("classConfigId", "sourceId");
