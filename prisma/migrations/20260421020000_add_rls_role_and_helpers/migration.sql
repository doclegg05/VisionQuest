-- Phase 3 (Slice A) of docs/plans/supabase-optimization.md
--
-- Codifies two database objects that the existing RLS policies already
-- depend on but were never committed as a migration:
--   * Role `vq_app` — restricted app-connection role (no superuser, no BYPASSRLS)
--   * Function `visionquest.managed_student_ids(text)` — returns the set of
--     student IDs an instructor manages via SpokesClassInstructor +
--     StudentClassEnrollment. Used by teacher RLS policy branches.
--
-- Both are created idempotently so re-applying against an environment
-- where someone pre-created them via the Supabase Dashboard is safe.
--
-- SECURITY DEFINER on managed_student_ids is intentional: the function is
-- called from RLS policies on other tables and needs to read
-- StudentClassEnrollment and SpokesClassInstructor itself. Without
-- SECURITY DEFINER, recursive policy evaluation would either deny access
-- or infinite-loop depending on policy topology. The function owner
-- (superuser at migration time) grants the privilege and `search_path` is
-- pinned to avoid hijacking.
--
-- Slice A lands the role + function + grants ONLY. The app still connects
-- as `postgres` (superuser), which BYPASSES RLS — so this migration is a
-- pure no-op from an access-control perspective. Slices B and C wire up
-- context propagation and the connection-role swap respectively.

-- ---------------------------------------------------------------
-- 1. Create vq_app role (idempotent)
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vq_app') THEN
    CREATE ROLE vq_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------
-- 2. Grant schema + table + sequence privileges to vq_app
--    (GRANT is idempotent — re-granting an existing privilege is a no-op)
-- ---------------------------------------------------------------
GRANT USAGE ON SCHEMA visionquest TO vq_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA visionquest TO vq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA visionquest TO vq_app;

-- Future tables created in this schema should inherit the same grants.
-- Note: ALTER DEFAULT PRIVILEGES is per-grantor; this only affects objects
-- created by the role running this migration (typically `postgres`).
ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest
  GRANT USAGE, SELECT ON SEQUENCES TO vq_app;

-- ---------------------------------------------------------------
-- 3. managed_student_ids helper function
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION visionquest.managed_student_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."studentId"
  FROM visionquest."StudentClassEnrollment" sce
  JOIN visionquest."SpokesClassInstructor" sci
    ON sci."classId" = sce."classId"
  WHERE sci."instructorId" = teacher_id
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn');
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

-- ---------------------------------------------------------------
-- 4. Ensure the function can read its dependency tables even when called
--    from a vq_app session with RLS enabled on those tables. SECURITY
--    DEFINER already runs as the function owner (postgres/superuser), so
--    RLS is bypassed inside the function body.
-- ---------------------------------------------------------------
