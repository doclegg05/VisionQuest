-- Tighten sage_operation_read: the teacher branch granted ANY teacher SELECT
-- on ALL SageOperation rows platform-wide (flagged in PR #156's security
-- review; the app layer compensates via assertStaffCanManageStudent, so this
-- is defense in depth, not a behavior change for legitimate access). Follows
-- the 20260701141000 SageMemory precedent: teacher access to student-related
-- rows gates through visionquest.managed_student_ids(). A row relates to a
-- student via targetStudentId (staff on-behalf-of writes, post-20260820120000)
-- or via actorType='student' + actorId (self-service and all legacy rows).
-- Rows with no student relation (system-scope tools, staff self-actions with
-- NULL targetStudentId) stay staff-visible, matching the memory precedent.
-- The student branch is unchanged: students see their own actor rows only
-- (widening students into on-behalf-of rows is a product decision, tracked in
-- .claude/MEMORY.md, not smuggled into a hardening migration).

DROP POLICY IF EXISTS "sage_operation_read" ON "visionquest"."SageOperation";
CREATE POLICY "sage_operation_read" ON "visionquest"."SageOperation"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "actorType" = 'student'
      AND "actorId" = current_setting('app.current_student_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND CASE
        WHEN "targetStudentId" IS NOT NULL
          THEN "targetStudentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        WHEN "actorType" = 'student'
          THEN "actorId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        ELSE true
      END
    )
  );
