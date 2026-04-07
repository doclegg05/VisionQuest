-- ===========================================================================
-- RLS Policies for All Remaining Student-Facing Tables
-- ===========================================================================
-- Extends the PoC migration (Goal, Conversation, Message) to cover every
-- table that contains student data.
--
-- GUCs (set via SET LOCAL by the Prisma extension):
--   app.current_user_id  -- the authenticated user's Student.id
--   app.current_role     -- 'student', 'teacher', or 'admin'
--   app.current_student_id -- same as user_id for students
--
-- Helper: visionquest.managed_student_ids(teacher_id) returns student IDs
--         for all classes that teacher instructs.
--
-- Access levels:
--   admin   = unrestricted
--   student = own rows only
--   teacher = rows for students in their classes (via managed_student_ids)

-- =========================================================================
-- PATTERN A: Standard student-owned (direct studentId FK)
-- =========================================================================

-- ---- MoodEntry ----
ALTER TABLE "visionquest"."MoodEntry" ENABLE ROW LEVEL SECURITY;

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

-- ---- Progression ----
ALTER TABLE "visionquest"."Progression" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "visionquest"."ProgressionEvent" ENABLE ROW LEVEL SECURITY;

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

-- ---- StudentTask ----
ALTER TABLE "visionquest"."StudentTask" ENABLE ROW LEVEL SECURITY;

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

-- ---- FileUpload ----
ALTER TABLE "visionquest"."FileUpload" ENABLE ROW LEVEL SECURITY;

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

-- ---- FormSubmission ----
ALTER TABLE "visionquest"."FormSubmission" ENABLE ROW LEVEL SECURITY;

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

-- ---- CareerDiscovery ----
ALTER TABLE "visionquest"."CareerDiscovery" ENABLE ROW LEVEL SECURITY;

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

-- ---- SpokesRecord ----
-- NOTE: studentId is nullable on SpokesRecord (unlinked referrals).
-- Policy allows access when studentId matches OR when studentId is null (admin/teacher only).
ALTER TABLE "visionquest"."SpokesRecord" ENABLE ROW LEVEL SECURITY;

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

-- ---- Notification ----
ALTER TABLE "visionquest"."Notification" ENABLE ROW LEVEL SECURITY;

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

-- ---- StudentAlert ----
ALTER TABLE "visionquest"."StudentAlert" ENABLE ROW LEVEL SECURITY;

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

-- ---- ResumeData ----
ALTER TABLE "visionquest"."ResumeData" ENABLE ROW LEVEL SECURITY;

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

-- ---- PortfolioItem ----
ALTER TABLE "visionquest"."PortfolioItem" ENABLE ROW LEVEL SECURITY;

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

-- ---- VisionBoardItem ----
ALTER TABLE "visionquest"."VisionBoardItem" ENABLE ROW LEVEL SECURITY;

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
-- Has direct studentId FK (confirmed in schema)
ALTER TABLE "visionquest"."GoalResourceLink" ENABLE ROW LEVEL SECURITY;

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

-- ---- CoachingArc ----
ALTER TABLE "visionquest"."CoachingArc" ENABLE ROW LEVEL SECURITY;

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

-- ---- OrientationProgress ----
ALTER TABLE "visionquest"."OrientationProgress" ENABLE ROW LEVEL SECURITY;

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

-- ---- NotificationPreference ----
ALTER TABLE "visionquest"."NotificationPreference" ENABLE ROW LEVEL SECURITY;

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

-- ---- Application ----
ALTER TABLE "visionquest"."Application" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "visionquest"."EventRegistration" ENABLE ROW LEVEL SECURITY;

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

-- ---- StudentSavedJob ----
ALTER TABLE "visionquest"."StudentSavedJob" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN B: Certification (direct studentId) + CertRequirement (nested)
-- =========================================================================

-- ---- Certification ----
ALTER TABLE "visionquest"."Certification" ENABLE ROW LEVEL SECURITY;

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

-- ---- CertRequirement ----
-- No direct studentId; must JOIN through Certification to resolve ownership.
ALTER TABLE "visionquest"."CertRequirement" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN C: Appointment (studentId + advisorId)
-- =========================================================================
-- Students see their own appointments.
-- Teachers see appointments where they are the advisor OR the student is managed.

ALTER TABLE "visionquest"."Appointment" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN D: CaseNote (instructor-only, students cannot see)
-- =========================================================================
-- Students should NOT see case notes.
-- Teachers see notes for their managed students.

ALTER TABLE "visionquest"."CaseNote" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN E: PublicCredentialPage (studentId + isPublic)
-- =========================================================================
-- For authenticated API access, use standard student-owned pattern.
-- Public (unauthenticated) access is handled by a separate route that
-- bypasses RLS entirely (reads via superuser or service role).

ALTER TABLE "visionquest"."PublicCredentialPage" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN F: StudentClassEnrollment (studentId + classId)
-- =========================================================================
-- Students see their own enrollments.
-- Teachers see enrollments in classes they instruct.

ALTER TABLE "visionquest"."StudentClassEnrollment" ENABLE ROW LEVEL SECURITY;

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

-- =========================================================================
-- PATTERN I: SpokesChecklistProgress, SpokesModuleProgress,
--            SpokesEmploymentFollowUp (nested via SpokesRecord.recordId)
-- =========================================================================
-- These tables reference recordId (SpokesRecord.id), not studentId directly.
-- Must JOIN through SpokesRecord to resolve the owning student.

-- ---- SpokesChecklistProgress ----
ALTER TABLE "visionquest"."SpokesChecklistProgress" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "visionquest"."SpokesModuleProgress" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "visionquest"."SpokesEmploymentFollowUp" ENABLE ROW LEVEL SECURITY;

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
