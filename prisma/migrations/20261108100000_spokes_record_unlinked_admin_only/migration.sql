-- Unlinked SPOKES referrals (studentId IS NULL) are applicants with no class.
-- The baseline teacher arm of spokes_record_access ended with
-- `OR "studentId" IS NULL`, so every teacher could read, update and delete
-- every unlinked referral in the state. Since 20261107120000 both coordinator
-- roles read as the teacher RLS role, which widened that to coordinators.
--
-- Unlinked referrals belong to admins at the database level. Every app path
-- that creates, lists or deletes one is admin-only, and intake provisioning
-- reads them through prismaAdmin, so no teacher-side reader depends on the
-- removed clause. Found in the PR #290 security review (MEDIUM-1).

DROP POLICY IF EXISTS "spokes_record_access" ON "visionquest"."SpokesRecord";

CREATE POLICY "spokes_record_access" ON "visionquest"."SpokesRecord"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );
