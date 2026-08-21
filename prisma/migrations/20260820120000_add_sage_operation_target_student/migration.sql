-- Sage ledger attribution: record the student an operation acted ON, not
-- just the invoker. Staff on-behalf-of writes (submit_form, file_document,
-- update_goal_status) previously persisted only the staff actorId, making
-- them invisible to any per-student ledger view.
-- Additive only: nullable column + index. No FK (matches actorId — ledger
-- rows must survive student offboarding). No data changes; legacy rows
-- stay NULL.
ALTER TABLE "visionquest"."SageOperation" ADD COLUMN "targetStudentId" TEXT;

CREATE INDEX "SageOperation_targetStudentId_idx"
  ON "visionquest"."SageOperation"("targetStudentId");
