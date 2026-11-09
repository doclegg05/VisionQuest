-- Postgres grants EXECUTE to PUBLIC on CREATE FUNCTION, and GRANT ... TO
-- vq_app does not remove that grant. These four SECURITY DEFINER scope helpers
-- run with their owner's rights and take an arbitrary user id, so any role
-- that can reach the visionquest schema could list another user's students or
-- classes. The org-tree helpers added in 20261107120000 already revoke PUBLIC;
-- these four never did. vq_app keeps EXECUTE.
-- src/lib/security-definer-grants.test.ts keeps every future definer function
-- in line. Found in the PR #290 security review (LOW-2).

REVOKE ALL ON FUNCTION visionquest.managed_student_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

REVOKE ALL ON FUNCTION visionquest.instructor_class_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.instructor_class_ids(text) TO vq_app;

REVOKE ALL ON FUNCTION visionquest.enrolled_class_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.enrolled_class_ids(text) TO vq_app;

REVOKE ALL ON FUNCTION visionquest.active_enrolled_class_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.active_enrolled_class_ids(text) TO vq_app;
