-- Student's permissive FOR ALL policy intentionally allows teachers to READ
-- fellow staff (advisor/instructor attribution). WITH CHECK limits new/updated
-- rows, but PostgreSQL does not apply it to DELETE. Add a restrictive DELETE
-- policy so that broad read access never grants deletion of another staff row.
-- Preserve the existing write matrix: admin, self, or a teacher's managed
-- student. Restrictive policies are ANDed with the existing permissive policy.
CREATE POLICY "student_delete_write_scope" ON "visionquest"."Student"
  AS RESTRICTIVE FOR DELETE TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR id = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND role = 'student'
      AND id IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );
