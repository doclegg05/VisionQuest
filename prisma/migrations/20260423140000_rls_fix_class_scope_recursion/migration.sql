-- ============================================================================
-- Fix: infinite recursion in class-scoped RLS policies
-- ============================================================================
-- Detected during Slice C cutover (2026-04-23). Any read of SpokesClass (and
-- several other class-scoped tables) under vq_app threw:
--   "42P17: infinite recursion detected in policy for relation
--   \"StudentClassEnrollment\""
--
-- Root cause: the policy chain forms a cycle —
--   SpokesClass (teacher branch) → SpokesClassInstructor
--   SpokesClassInstructor (student branch) → StudentClassEnrollment
--   StudentClassEnrollment (teacher branch) → SpokesClassInstructor
-- Postgres evaluates each subquery under RLS too, so the evaluator
-- re-enters the same policy tree forever.
--
-- Fix: introduce two SECURITY DEFINER helper functions (same pattern as
-- `managed_student_ids`). They run as the function owner (postgres) and
-- bypass RLS on their internal lookups, breaking the cycle. Then rewrite
-- each class-scoped policy to call the helper instead of inlining the
-- subquery.
-- ============================================================================

-- ---------------------------------------------------------------
-- Helper functions (SECURITY DEFINER bypasses RLS on lookups)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION visionquest.instructor_class_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sci."classId"
  FROM visionquest."SpokesClassInstructor" sci
  WHERE sci."instructorId" = teacher_id;
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.instructor_class_ids(text) TO vq_app;

CREATE OR REPLACE FUNCTION visionquest.enrolled_class_ids(student_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."classId"
  FROM visionquest."StudentClassEnrollment" sce
  WHERE sce."studentId" = student_id;
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.enrolled_class_ids(text) TO vq_app;

-- ---------------------------------------------------------------
-- Rewrite policies to call the helpers
-- ---------------------------------------------------------------

-- ---- StudentClassEnrollment ----
DROP POLICY IF EXISTS "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- SpokesClass ----
DROP POLICY IF EXISTS "spokes_class_access" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_access" ON "visionquest"."SpokesClass"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND id IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- SpokesClassInstructor ----
DROP POLICY IF EXISTS "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "instructorId" = current_setting('app.current_user_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
  );

-- ---- ClassRequirement ----
DROP POLICY IF EXISTS "class_requirement_access" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_access" ON "visionquest"."ClassRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- JobClassConfig ----
DROP POLICY IF EXISTS "job_class_config_access" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_access" ON "visionquest"."JobClassConfig"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- JobListing (nested via JobClassConfig) ----
DROP POLICY IF EXISTS "job_listing_access" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_access" ON "visionquest"."JobListing"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND (
        (
          current_setting('app.current_role', true) = 'student'
          AND jcc."classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
        )
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND jcc."classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND current_setting('app.current_role', true) = 'teacher'
      AND jcc."classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FormAssignment (student branch uses enrolled_class_ids) ----
DROP POLICY IF EXISTS "form_assignment_read" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_read" ON "visionquest"."FormAssignment"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND (
        (scope = 'student' AND "targetId" = current_setting('app.current_user_id', true))
        OR (
          scope = 'class'
          AND "targetId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  );
