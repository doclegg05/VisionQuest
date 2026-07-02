-- Fix: SageMemory's teacher-role RLS policies had no per-classroom scoping,
-- unlike every other student-PII table (Student, Goal, GoalResourceLink),
-- which gate the teacher branch through visionquest.managed_student_ids().
-- A teacher account could read/correct/delete ANY student's Sage memories
-- platform-wide. This does not change legitimate access: any teacher who
-- currently reaches these routes has already passed assertStaffCanManageStudent,
-- which is itself RLS-scoped via the Student table's own managed_student_ids()
-- policy — so this closes a gap, it does not add a new restriction for
-- teachers who are supposed to have access. Non-student subject types
-- (teacher/class/program) are not currently written anywhere in the app and
-- stay staff-visible unscoped, matching current behavior for those rows.

DROP POLICY IF EXISTS "sage_memory_read" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_read" ON "visionquest"."SageMemory"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "subjectType" = 'student'
      AND "subjectId" = current_setting('app.current_student_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "subjectType" != 'student'
        OR "subjectId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

DROP POLICY IF EXISTS "sage_memory_insert" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_insert" ON "visionquest"."SageMemory"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "subjectType" = 'student'
      AND "subjectId" = current_setting('app.current_student_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "subjectType" != 'student'
        OR "subjectId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

DROP POLICY IF EXISTS "sage_memory_modify" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_modify" ON "visionquest"."SageMemory"
  FOR UPDATE TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "subjectType" != 'student'
        OR "subjectId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "subjectType" != 'student'
        OR "subjectId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

DROP POLICY IF EXISTS "sage_memory_delete" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_delete" ON "visionquest"."SageMemory"
  FOR DELETE TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "subjectType" != 'student'
        OR "subjectId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );
