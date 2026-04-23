-- ============================================================================
-- RLS Policy Recovery — Port rolled-back 20260403060000 to current schema
-- ============================================================================
-- Context:
--   Migration `20260403060000_rls_remaining_tables` rolled back on its first
--   apply (2026-04-03) because it referenced the `vq_app` role two weeks
--   before that role was created. `migrate resolve --rolled-back` cleared it
--   from the history but it was never re-applied. Result: prod has RLS
--   enabled on every table (from `20260415000000`) but ZERO policies. Any
--   query from a non-superuser returns zero rows.
--
--   This migration is the last Slice-C prerequisite. It creates the full
--   policy surface so that when `DATABASE_URL` flips from `postgres` to
--   `vq_app`, the app continues to work.
--
-- Role model:
--   The Prisma extension (`src/lib/db.ts`) + middleware (`src/proxy.ts`) set
--   three session GUCs from the verified JWT:
--     app.current_user_id   — Student.id of the authenticated user
--     app.current_role      — 'student' | 'teacher' | 'admin'
--     app.current_student_id — same as user_id for students; empty for staff
--
--   NOTE on coordinator/cdc roles:
--     `rlsHeadersFromClaims` (src/lib/rls-headers.ts) currently collapses
--     every role that is not 'admin' or 'teacher' into 'student' with an
--     empty studentId. Coordinator users therefore hit fail-closed on all
--     student-owned tables. Expanding the header module to first-class
--     'coordinator' support is deliberately out of scope for this migration;
--     Slice D will revisit when coordinator workflows come online.
--
-- Access matrix (baseline for most tables):
--   admin   — unrestricted
--   student — rows where studentId = app.current_user_id
--   teacher — rows where studentId IN managed_student_ids(app.current_user_id)
--
-- Idempotency:
--   Every CREATE POLICY is preceded by DROP POLICY IF EXISTS so the
--   migration can be safely re-applied in dev DBs that already have some
--   of the earlier April 3 policies (a few devs ran the rolled-back
--   migration against local DBs before it was marked failed).
-- ============================================================================

-- ============================================================================
-- 0. Ensure RLS is enabled on tables added after 20260415000000
--    Forms Hub (FormTemplate, FormAssignment, FormResponse) and Region/Grant
--    (Region, RegionCoordinator, GrantGoal) were added after the blanket
--    enable-RLS migration and never had it turned on.
-- ============================================================================

ALTER TABLE "visionquest"."FormTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."RegionCoordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."GrantGoal" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PATTERN A: Student-owned (direct studentId FK)
-- Most tables follow this pattern: student sees own, teacher sees managed,
-- admin sees all. Both USING (for reads and row visibility) and WITH CHECK
-- (for writes) use the same clause so students can't insert/update as
-- someone else.
-- ============================================================================

-- ---- NotificationPreference ----
DROP POLICY IF EXISTS "notification_preference_access" ON "visionquest"."NotificationPreference";
CREATE POLICY "notification_preference_access" ON "visionquest"."NotificationPreference"
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

-- ---- Progression ----
DROP POLICY IF EXISTS "progression_access" ON "visionquest"."Progression";
CREATE POLICY "progression_access" ON "visionquest"."Progression"
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

-- ---- ProgressionEvent ----
DROP POLICY IF EXISTS "progression_event_access" ON "visionquest"."ProgressionEvent";
CREATE POLICY "progression_event_access" ON "visionquest"."ProgressionEvent"
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

-- ---- OrientationProgress ----
DROP POLICY IF EXISTS "orientation_progress_access" ON "visionquest"."OrientationProgress";
CREATE POLICY "orientation_progress_access" ON "visionquest"."OrientationProgress"
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

-- ---- PortfolioItem ----
DROP POLICY IF EXISTS "portfolio_item_access" ON "visionquest"."PortfolioItem";
CREATE POLICY "portfolio_item_access" ON "visionquest"."PortfolioItem"
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

-- ---- ResumeData ----
DROP POLICY IF EXISTS "resume_data_access" ON "visionquest"."ResumeData";
CREATE POLICY "resume_data_access" ON "visionquest"."ResumeData"
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

-- ---- FileUpload ----
DROP POLICY IF EXISTS "file_upload_access" ON "visionquest"."FileUpload";
CREATE POLICY "file_upload_access" ON "visionquest"."FileUpload"
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

-- ---- StudentTask ----
DROP POLICY IF EXISTS "student_task_access" ON "visionquest"."StudentTask";
CREATE POLICY "student_task_access" ON "visionquest"."StudentTask"
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

-- ---- StudentAlert ----
DROP POLICY IF EXISTS "student_alert_access" ON "visionquest"."StudentAlert";
CREATE POLICY "student_alert_access" ON "visionquest"."StudentAlert"
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

-- ---- Application ----
DROP POLICY IF EXISTS "application_access" ON "visionquest"."Application";
CREATE POLICY "application_access" ON "visionquest"."Application"
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

-- ---- EventRegistration ----
DROP POLICY IF EXISTS "event_registration_access" ON "visionquest"."EventRegistration";
CREATE POLICY "event_registration_access" ON "visionquest"."EventRegistration"
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

-- ---- PublicCredentialPage ----
-- NOTE: unauthenticated access to public credential pages is served via a
-- separate route that uses prismaAdmin, bypassing RLS. This policy only
-- covers authenticated in-app reads/writes.
DROP POLICY IF EXISTS "public_credential_page_access" ON "visionquest"."PublicCredentialPage";
CREATE POLICY "public_credential_page_access" ON "visionquest"."PublicCredentialPage"
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

-- ---- Notification ----
DROP POLICY IF EXISTS "notification_access" ON "visionquest"."Notification";
CREATE POLICY "notification_access" ON "visionquest"."Notification"
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

-- ---- FormSubmission ----
DROP POLICY IF EXISTS "form_submission_access" ON "visionquest"."FormSubmission";
CREATE POLICY "form_submission_access" ON "visionquest"."FormSubmission"
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

-- ---- VisionBoardItem ----
DROP POLICY IF EXISTS "vision_board_item_access" ON "visionquest"."VisionBoardItem";
CREATE POLICY "vision_board_item_access" ON "visionquest"."VisionBoardItem"
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

-- ---- GoalResourceLink ----
DROP POLICY IF EXISTS "goal_resource_link_access" ON "visionquest"."GoalResourceLink";
CREATE POLICY "goal_resource_link_access" ON "visionquest"."GoalResourceLink"
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

-- ---- CareerDiscovery ----
DROP POLICY IF EXISTS "career_discovery_access" ON "visionquest"."CareerDiscovery";
CREATE POLICY "career_discovery_access" ON "visionquest"."CareerDiscovery"
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

-- ---- MoodEntry ----
DROP POLICY IF EXISTS "mood_entry_access" ON "visionquest"."MoodEntry";
CREATE POLICY "mood_entry_access" ON "visionquest"."MoodEntry"
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

-- ---- CoachingArc ----
DROP POLICY IF EXISTS "coaching_arc_access" ON "visionquest"."CoachingArc";
CREATE POLICY "coaching_arc_access" ON "visionquest"."CoachingArc"
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

-- ---- StudentSavedJob ----
DROP POLICY IF EXISTS "student_saved_job_access" ON "visionquest"."StudentSavedJob";
CREATE POLICY "student_saved_job_access" ON "visionquest"."StudentSavedJob"
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

-- ---- LlmCallLog (new, not in April 3 migration) ----
DROP POLICY IF EXISTS "llm_call_log_access" ON "visionquest"."LlmCallLog";
CREATE POLICY "llm_call_log_access" ON "visionquest"."LlmCallLog"
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

-- ---- FormResponse (new, not in April 3 migration) ----
DROP POLICY IF EXISTS "form_response_access" ON "visionquest"."FormResponse";
CREATE POLICY "form_response_access" ON "visionquest"."FormResponse"
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

-- ============================================================================
-- PATTERN B: Student-owned with nullable studentId (SpokesRecord)
-- Unlinked referrals (studentId IS NULL) are visible to staff only.
-- ============================================================================

DROP POLICY IF EXISTS "spokes_record_access" ON "visionquest"."SpokesRecord";
CREATE POLICY "spokes_record_access" ON "visionquest"."SpokesRecord"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  );

-- ============================================================================
-- PATTERN C: Certification + nested CertRequirement
-- ============================================================================

-- ---- Certification ----
DROP POLICY IF EXISTS "certification_access" ON "visionquest"."Certification";
CREATE POLICY "certification_access" ON "visionquest"."Certification"
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

-- ---- CertRequirement (nested via certificationId) ----
DROP POLICY IF EXISTS "cert_requirement_access" ON "visionquest"."CertRequirement";
CREATE POLICY "cert_requirement_access" ON "visionquest"."CertRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  );

-- ============================================================================
-- PATTERN D: Appointment (dual ownership — studentId OR advisorId)
-- ============================================================================

DROP POLICY IF EXISTS "appointment_access" ON "visionquest"."Appointment";
CREATE POLICY "appointment_access" ON "visionquest"."Appointment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

-- ---- AdvisorAvailability ----
-- Students need read access to book appointments; teachers read/write own.
DROP POLICY IF EXISTS "advisor_availability_read" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_read" ON "visionquest"."AdvisorAvailability"
  FOR SELECT TO vq_app
  USING (active = true OR "advisorId" = current_setting('app.current_user_id', true) OR current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "advisor_availability_write" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_write" ON "visionquest"."AdvisorAvailability"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (current_setting('app.current_role', true) = 'teacher' AND "advisorId" = current_setting('app.current_user_id', true))
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (current_setting('app.current_role', true) = 'teacher' AND "advisorId" = current_setting('app.current_user_id', true))
  );

-- ============================================================================
-- PATTERN E: Teacher-only (students cannot see CaseNote)
-- ============================================================================

DROP POLICY IF EXISTS "case_note_access" ON "visionquest"."CaseNote";
CREATE POLICY "case_note_access" ON "visionquest"."CaseNote"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN F: Class-scoped (StudentClassEnrollment, SpokesClass, etc.)
-- ============================================================================

-- ---- StudentClassEnrollment ----
DROP POLICY IF EXISTS "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- SpokesClass ----
-- Students see classes they're enrolled in; teachers see classes they instruct.
DROP POLICY IF EXISTS "spokes_class_access" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_access" ON "visionquest"."SpokesClass"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND id IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- SpokesClassInstructor ----
-- Teachers see their own assignments + assignments for their classes; admin sees all.
-- Students see their class instructors (so "your instructor is X" can display).
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
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
  );

-- ---- ClassRequirement ----
-- Students see requirements for their enrolled classes; teachers see for their classes.
DROP POLICY IF EXISTS "class_requirement_access" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_access" ON "visionquest"."ClassRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- JobClassConfig ----
-- Teacher sees configs for their classes; students see config for their enrolled classes (for job feed).
DROP POLICY IF EXISTS "job_class_config_access" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_access" ON "visionquest"."JobClassConfig"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- JobListing ----
-- Scoped via JobClassConfig.classId.
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
          AND jcc."classId" IN (
            SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
            WHERE sce."studentId" = current_setting('app.current_user_id', true)
          )
        )
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND jcc."classId" IN (
            SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
            WHERE sci."instructorId" = current_setting('app.current_user_id', true)
          )
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
      AND jcc."classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ============================================================================
-- PATTERN G: Nested via SpokesRecord.recordId
-- ============================================================================

-- ---- SpokesChecklistProgress ----
DROP POLICY IF EXISTS "spokes_checklist_progress_access" ON "visionquest"."SpokesChecklistProgress";
CREATE POLICY "spokes_checklist_progress_access" ON "visionquest"."SpokesChecklistProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesModuleProgress ----
DROP POLICY IF EXISTS "spokes_module_progress_access" ON "visionquest"."SpokesModuleProgress";
CREATE POLICY "spokes_module_progress_access" ON "visionquest"."SpokesModuleProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesEmploymentFollowUp ----
DROP POLICY IF EXISTS "spokes_employment_followup_access" ON "visionquest"."SpokesEmploymentFollowUp";
CREATE POLICY "spokes_employment_followup_access" ON "visionquest"."SpokesEmploymentFollowUp"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ============================================================================
-- PATTERN H: Core chat + goals (Student, Conversation, Message, Goal)
-- Never in April 3 migration. Student table is handled last (special).
-- ============================================================================

-- ---- Conversation ----
DROP POLICY IF EXISTS "conversation_access" ON "visionquest"."Conversation";
CREATE POLICY "conversation_access" ON "visionquest"."Conversation"
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

-- ---- Message ----
DROP POLICY IF EXISTS "message_access" ON "visionquest"."Message";
CREATE POLICY "message_access" ON "visionquest"."Message"
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

-- ---- Goal ----
DROP POLICY IF EXISTS "goal_access" ON "visionquest"."Goal";
CREATE POLICY "goal_access" ON "visionquest"."Goal"
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

-- ============================================================================
-- PATTERN I: Student table — PII-sensitive, tight policy
-- Row = the Student record for a user (includes passwordHash, mfaSecret,
-- geminiApiKey). Any exposure beyond own-row is a PII leak.
--
-- READ:
--   - admin: all rows
--   - teacher: own row + managed students' rows + fellow staff rows
--             (needed for advisor picker, instructor attribution)
--   - student: own row only
-- WRITE:
--   - admin: all
--   - teacher: own row + managed students
--   - student: own row only
--
-- Code that needs broader lookups (e.g. "list all advisors", "show author
-- of case note") must use `prismaAdmin` — which bypasses RLS by connecting
-- as the unrestricted role.
-- ============================================================================

DROP POLICY IF EXISTS "student_self_access" ON "visionquest"."Student";
CREATE POLICY "student_self_access" ON "visionquest"."Student"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR id = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        id IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR role IN ('teacher', 'admin', 'coordinator', 'cdc')
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR id = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN J: Own-only auth tables (no teacher/managed access)
-- Password resets and security question answers belong to the student alone.
-- Staff should never need these in-band — reset flows run as prismaAdmin.
-- ============================================================================

-- ---- PasswordResetToken ----
DROP POLICY IF EXISTS "password_reset_token_access" ON "visionquest"."PasswordResetToken";
CREATE POLICY "password_reset_token_access" ON "visionquest"."PasswordResetToken"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- ---- SecurityQuestionAnswer ----
DROP POLICY IF EXISTS "security_question_answer_access" ON "visionquest"."SecurityQuestionAnswer";
CREATE POLICY "security_question_answer_access" ON "visionquest"."SecurityQuestionAnswer"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- ============================================================================
-- PATTERN K: Admin-only system tables
-- ============================================================================

-- ---- SystemConfig (encrypted API keys — admin only) ----
DROP POLICY IF EXISTS "system_config_admin_only" ON "visionquest"."SystemConfig";
CREATE POLICY "system_config_admin_only" ON "visionquest"."SystemConfig"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- AuditLog (admin read; cron/admin writes) ----
DROP POLICY IF EXISTS "audit_log_admin_only" ON "visionquest"."AuditLog";
CREATE POLICY "audit_log_admin_only" ON "visionquest"."AuditLog"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- WebhookSubscription (admin only) ----
DROP POLICY IF EXISTS "webhook_subscription_admin_only" ON "visionquest"."WebhookSubscription";
CREATE POLICY "webhook_subscription_admin_only" ON "visionquest"."WebhookSubscription"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- BackgroundJob (admin only; cron runs as prismaAdmin) ----
DROP POLICY IF EXISTS "background_job_admin_only" ON "visionquest"."BackgroundJob";
CREATE POLICY "background_job_admin_only" ON "visionquest"."BackgroundJob"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- RateLimitEntry (admin only; rate-limiter runs as prismaAdmin) ----
DROP POLICY IF EXISTS "rate_limit_entry_admin_only" ON "visionquest"."RateLimitEntry";
CREATE POLICY "rate_limit_entry_admin_only" ON "visionquest"."RateLimitEntry"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- GrantKpiSnapshot (admin only for now; coordinators via prismaAdmin) ----
DROP POLICY IF EXISTS "grant_kpi_snapshot_admin_only" ON "visionquest"."GrantKpiSnapshot";
CREATE POLICY "grant_kpi_snapshot_admin_only" ON "visionquest"."GrantKpiSnapshot"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- Role / Permission / RolePermission (admin only) ----
DROP POLICY IF EXISTS "role_admin_only" ON "visionquest"."Role";
CREATE POLICY "role_admin_only" ON "visionquest"."Role"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "permission_admin_only" ON "visionquest"."Permission";
CREATE POLICY "permission_admin_only" ON "visionquest"."Permission"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "role_permission_admin_only" ON "visionquest"."RolePermission";
CREATE POLICY "role_permission_admin_only" ON "visionquest"."RolePermission"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ============================================================================
-- PATTERN L: Program-config templates (shared read, admin write)
-- These tables hold read-only reference data displayed to all authenticated
-- users. Writes are admin-only; teachers can author snippets/pathways.
-- ============================================================================

-- ---- OrientationItem ----
DROP POLICY IF EXISTS "orientation_item_read" ON "visionquest"."OrientationItem";
CREATE POLICY "orientation_item_read" ON "visionquest"."OrientationItem"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "orientation_item_write" ON "visionquest"."OrientationItem";
CREATE POLICY "orientation_item_write" ON "visionquest"."OrientationItem"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- LmsLink ----
DROP POLICY IF EXISTS "lms_link_read" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_read" ON "visionquest"."LmsLink"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "lms_link_write" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_write" ON "visionquest"."LmsLink"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- SpokesChecklistTemplate ----
DROP POLICY IF EXISTS "spokes_checklist_template_read" ON "visionquest"."SpokesChecklistTemplate";
CREATE POLICY "spokes_checklist_template_read" ON "visionquest"."SpokesChecklistTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "spokes_checklist_template_write" ON "visionquest"."SpokesChecklistTemplate";
CREATE POLICY "spokes_checklist_template_write" ON "visionquest"."SpokesChecklistTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- SpokesModuleTemplate ----
DROP POLICY IF EXISTS "spokes_module_template_read" ON "visionquest"."SpokesModuleTemplate";
CREATE POLICY "spokes_module_template_read" ON "visionquest"."SpokesModuleTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "spokes_module_template_write" ON "visionquest"."SpokesModuleTemplate";
CREATE POLICY "spokes_module_template_write" ON "visionquest"."SpokesModuleTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- CertTemplate ----
DROP POLICY IF EXISTS "cert_template_read" ON "visionquest"."CertTemplate";
CREATE POLICY "cert_template_read" ON "visionquest"."CertTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "cert_template_write" ON "visionquest"."CertTemplate";
CREATE POLICY "cert_template_write" ON "visionquest"."CertTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- SageSnippet (teacher/admin write, all auth read) ----
DROP POLICY IF EXISTS "sage_snippet_read" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_read" ON "visionquest"."SageSnippet"
  FOR SELECT TO vq_app
  USING ("isActive" = true OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "sage_snippet_write" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_write" ON "visionquest"."SageSnippet"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- Pathway ----
DROP POLICY IF EXISTS "pathway_read" ON "visionquest"."Pathway";
CREATE POLICY "pathway_read" ON "visionquest"."Pathway"
  FOR SELECT TO vq_app
  USING (active = true OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "pathway_write" ON "visionquest"."Pathway";
CREATE POLICY "pathway_write" ON "visionquest"."Pathway"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- Opportunity ----
DROP POLICY IF EXISTS "opportunity_read" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_read" ON "visionquest"."Opportunity"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "opportunity_write" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_write" ON "visionquest"."Opportunity"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- CareerEvent ----
DROP POLICY IF EXISTS "career_event_read" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_read" ON "visionquest"."CareerEvent"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "career_event_write" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_write" ON "visionquest"."CareerEvent"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- ProgramDocument (audience-aware visibility) ----
-- STUDENT audience: only students (+ staff for management)
-- TEACHER audience: only staff (+ admin)
-- BOTH: everyone
DROP POLICY IF EXISTS "program_document_read" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_read" ON "visionquest"."ProgramDocument"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR audience = 'BOTH'
    OR (audience = 'STUDENT' AND current_setting('app.current_role', true) = 'student')
    OR (audience = 'TEACHER' AND current_setting('app.current_role', true) = 'teacher')
  );

DROP POLICY IF EXISTS "program_document_write" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_write" ON "visionquest"."ProgramDocument"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ============================================================================
-- PATTERN M: Forms Hub (structured forms, Phase 4)
-- FormTemplate / FormAssignment are program configuration — all auth'd users
-- can read assigned forms; teachers/admins author.
-- FormResponse is student-owned (covered under Pattern A above).
-- ============================================================================

-- ---- FormTemplate ----
DROP POLICY IF EXISTS "form_template_read" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_read" ON "visionquest"."FormTemplate"
  FOR SELECT TO vq_app
  USING (status = 'active' OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "form_template_write" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_write" ON "visionquest"."FormTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- FormAssignment ----
-- Students see assignments targeting them (scope='student', targetId = own id)
-- or targeting classes they're enrolled in (scope='class').
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
          AND "targetId" IN (
            SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
            WHERE sce."studentId" = current_setting('app.current_user_id', true)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "form_assignment_write" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_write" ON "visionquest"."FormAssignment"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ============================================================================
-- PATTERN N: Regions / Grant goals (Phase 5)
-- Coordinator-first-class access is a Slice D concern (see coordinator note
-- in the migration header). For now: admin-only write; all authenticated
-- users can read region metadata (names are not sensitive).
-- ============================================================================

-- ---- Region ----
DROP POLICY IF EXISTS "region_read" ON "visionquest"."Region";
CREATE POLICY "region_read" ON "visionquest"."Region"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "region_write" ON "visionquest"."Region";
CREATE POLICY "region_write" ON "visionquest"."Region"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- RegionCoordinator ----
-- Reveals which coordinator manages which region. Admin-only for now.
DROP POLICY IF EXISTS "region_coordinator_admin_only" ON "visionquest"."RegionCoordinator";
CREATE POLICY "region_coordinator_admin_only" ON "visionquest"."RegionCoordinator"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- GrantGoal ----
DROP POLICY IF EXISTS "grant_goal_admin_only" ON "visionquest"."GrantGoal";
CREATE POLICY "grant_goal_admin_only" ON "visionquest"."GrantGoal"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');
