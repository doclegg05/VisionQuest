-- Organization tree, Phase 1, Task 3: RLS follows the tree.
--
-- The app maps both coordinator roles to the RLS role 'teacher' (rlsRoleFor in
-- src/lib/rls-headers.ts), so every teacher policy branch now also decides
-- what coordinators reach. This migration:
--
--   1. adds role helpers. Each one checks Student.role itself, so a teacher
--      who still holds a stale RegionCoordinator row reaches nothing through it;
--   2. widens managed_student_ids (students) and instructor_class_ids (classes)
--      to a regional coordinator's regions and, for a program coordinator, to
--      everything. Both read live tables, so removing a RegionCoordinator row
--      removes access on the next query. A class with no region reaches no
--      regional coordinator. A coordinator with no regions reaches nothing;
--   3. lets coordinators read their own region assignments;
--   4. keeps tree readers (is_tree_reader) out of chat transcripts and text
--      derived from them, except rows they own (their own staff Sage chat);
--   5. stops tree readers writing any table that has a teacher write branch,
--      except rows they own (ruling R8). Coordinators read; the app layer is
--      no longer the only guard.
--
-- Instructors, admins and students are unaffected: is_tree_reader is false
-- for them, so every restrictive policy here passes and the permissive
-- policies decide exactly as before. prismaAdmin bypasses RLS.

-- ---------------------------------------------------------------------
-- 1. Role helpers. SECURITY DEFINER so they can read Student.role and
--    RegionCoordinator from inside a policy without recursing into those
--    tables' own policies. Unknown or empty ids return false or nothing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION visionquest.is_tree_reader(user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM visionquest."Student" s
    WHERE s.id = user_id
      AND s.role IN ('coordinator', 'program_coordinator')
  );
$fn$;

REVOKE ALL ON FUNCTION visionquest.is_tree_reader(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.is_tree_reader(text) TO vq_app;

CREATE OR REPLACE FUNCTION visionquest.is_program_coordinator(user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM visionquest."Student" s
    WHERE s.id = user_id
      AND s.role = 'program_coordinator'
  );
$fn$;

REVOKE ALL ON FUNCTION visionquest.is_program_coordinator(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.is_program_coordinator(text) TO vq_app;

-- Regions a user coordinates: their RegionCoordinator rows while their role is
-- 'coordinator', or every region for a program coordinator.
CREATE OR REPLACE FUNCTION visionquest.coordinated_region_ids(user_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT rc."regionId"
  FROM visionquest."RegionCoordinator" rc
  JOIN visionquest."Student" k
    ON k.id = rc."coordinatorId"
   AND k.role = 'coordinator'
  WHERE rc."coordinatorId" = user_id
  UNION
  SELECT r.id
  FROM visionquest."Region" r
  WHERE visionquest.is_program_coordinator(user_id);
$fn$;

REVOKE ALL ON FUNCTION visionquest.coordinated_region_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visionquest.coordinated_region_ids(text) TO vq_app;

-- ---------------------------------------------------------------------
-- 2. Scope functions. The parameters keep their original names: CREATE OR
--    REPLACE cannot rename an input parameter, and policies depend on both.
-- ---------------------------------------------------------------------

-- Students: enrolled in a class the user instructs; enrolled in a class in a
-- region they coordinate; or, for a program coordinator, every student.
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
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn')
  UNION
  SELECT sce."studentId"
  FROM visionquest."StudentClassEnrollment" sce
  JOIN visionquest."SpokesClass" c
    ON c.id = sce."classId"
  WHERE c."regionId" IN (SELECT visionquest.coordinated_region_ids(teacher_id))
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn')
  UNION
  SELECT s.id
  FROM visionquest."Student" s
  WHERE s.role = 'student'
    AND visionquest.is_program_coordinator(teacher_id);
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

-- Classes: ones the user instructs; ones in a region they coordinate; or, for
-- a program coordinator, every class (classes with no region included).
-- Teacher branches on SpokesClass, StudentClassEnrollment, ClassRequirement,
-- JobClassConfig, JobListing and JobLead read through this.
CREATE OR REPLACE FUNCTION visionquest.instructor_class_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sci."classId"
  FROM visionquest."SpokesClassInstructor" sci
  WHERE sci."instructorId" = teacher_id
  UNION
  SELECT c.id
  FROM visionquest."SpokesClass" c
  WHERE c."regionId" IN (SELECT visionquest.coordinated_region_ids(teacher_id))
  UNION
  SELECT c.id
  FROM visionquest."SpokesClass" c
  WHERE visionquest.is_program_coordinator(teacher_id);
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.instructor_class_ids(text) TO vq_app;

-- ---------------------------------------------------------------------
-- 3. Region assignments a coordinator may read. Region itself is already
--    readable by everyone (region_read USING (true)). Writes stay admin-only.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "region_coordinator_tree_reader_read" ON "visionquest"."RegionCoordinator";
CREATE POLICY "region_coordinator_tree_reader_read" ON "visionquest"."RegionCoordinator"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'teacher'
    AND (
      (
        "coordinatorId" = current_setting('app.current_user_id', true)
        AND (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
      )
      OR (SELECT visionquest.is_program_coordinator(current_setting('app.current_user_id', true)))
    )
  );

DROP POLICY IF EXISTS "region_instructor_tree_reader_read" ON "visionquest"."RegionInstructor";
CREATE POLICY "region_instructor_tree_reader_read" ON "visionquest"."RegionInstructor"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'teacher'
    AND "regionId" IN (SELECT visionquest.coordinated_region_ids(current_setting('app.current_user_id', true)))
  );

-- ---------------------------------------------------------------------
-- 4. Transcript tables refuse tree readers, reads and writes.
--    RESTRICTIVE policies are ANDed with the permissive ones. The function
--    call sits in a scalar subquery so Postgres evaluates it once per
--    statement, not once per row. Each policy's tail names the column that
--    marks a row as the caller's own.
-- ---------------------------------------------------------------------

-- Chat transcripts, including each conversation's rolling summary.
DROP POLICY IF EXISTS "conversation_tree_reader_block" ON "visionquest"."Conversation";
CREATE POLICY "conversation_tree_reader_block" ON "visionquest"."Conversation"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

DROP POLICY IF EXISTS "message_tree_reader_block" ON "visionquest"."Message";
CREATE POLICY "message_tree_reader_block" ON "visionquest"."Message"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Observations Sage drew from a turn (content, sourceMessageId).
DROP POLICY IF EXISTS "sage_insight_tree_reader_block" ON "visionquest"."SageInsight";
CREATE POLICY "sage_insight_tree_reader_block" ON "visionquest"."SageInsight"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Long-term memories extracted from conversations.
DROP POLICY IF EXISTS "sage_memory_tree_reader_block" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_tree_reader_block" ON "visionquest"."SageMemory"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "subjectId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "subjectId" = current_setting('app.current_user_id', true)
  );

-- Memory edges carry an evidence text drawn from the same memories.
DROP POLICY IF EXISTS "sage_memory_edge_tree_reader_block" ON "visionquest"."SageMemoryEdge";
CREATE POLICY "sage_memory_edge_tree_reader_block" ON "visionquest"."SageMemoryEdge"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SageMemory" m
      WHERE m.id = "SageMemoryEdge"."fromId"
        AND m."subjectId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SageMemory" m
      WHERE m.id = "SageMemoryEdge"."fromId"
        AND m."subjectId" = current_setting('app.current_user_id', true)
    )
  );

-- Mood scores with the context the student gave, extracted from chat.
DROP POLICY IF EXISTS "mood_entry_tree_reader_block" ON "visionquest"."MoodEntry";
CREATE POLICY "mood_entry_tree_reader_block" ON "visionquest"."MoodEntry"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Interests, circumstances and summaries the discovery extractor pulled
-- from the career-discovery conversation.
DROP POLICY IF EXISTS "career_discovery_tree_reader_block" ON "visionquest"."CareerDiscovery";
CREATE POLICY "career_discovery_tree_reader_block" ON "visionquest"."CareerDiscovery"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Dead-lettered extractions: payload is a snapshot of the chat input.
DROP POLICY IF EXISTS "failed_extraction_tree_reader_block" ON "visionquest"."FailedExtraction";
CREATE POLICY "failed_extraction_tree_reader_block" ON "visionquest"."FailedExtraction"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Daily briefing specs, written by a model over a context bundle that
-- carries SageInsight rows.
DROP POLICY IF EXISTS "sage_panel_tree_reader_block" ON "visionquest"."SagePanel";
CREATE POLICY "sage_panel_tree_reader_block" ON "visionquest"."SagePanel"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Lost-wager diagnoses, written by a model over the same bundle.
DROP POLICY IF EXISTS "wager_verdict_tree_reader_block" ON "visionquest"."WagerVerdict";
CREATE POLICY "wager_verdict_tree_reader_block" ON "visionquest"."WagerVerdict"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Wager" w
      WHERE w.id = "WagerVerdict"."wagerId"
        AND w."studentId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Wager" w
      WHERE w.id = "WagerVerdict"."wagerId"
        AND w."studentId" = current_setting('app.current_user_id', true)
    )
  );

-- Sage tool-call ledger: payload holds the model's tool arguments, drawn
-- from the conversation. A coordinator keeps their own operations.
DROP POLICY IF EXISTS "sage_operation_tree_reader_block" ON "visionquest"."SageOperation";
CREATE POLICY "sage_operation_tree_reader_block" ON "visionquest"."SageOperation"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "actorId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "actorId" = current_setting('app.current_user_id', true)
  );

-- Staff-action alert cards. Their summaries quote what a student told Sage
-- (stated classroom and instructor) and carry crisis categories (ruling R10).
DROP POLICY IF EXISTS "student_alert_tree_reader_block" ON "visionquest"."StudentAlert";
CREATE POLICY "student_alert_tree_reader_block" ON "visionquest"."StudentAlert"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- Uploaded documents, including chat attachments and the model-written gist
-- and classification (ruling R10). A coordinator keeps their own uploads.
DROP POLICY IF EXISTS "file_upload_tree_reader_block" ON "visionquest"."FileUpload";
CREATE POLICY "file_upload_tree_reader_block" ON "visionquest"."FileUpload"
  AS RESTRICTIVE FOR ALL TO vq_app
  USING (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true)))
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- ---------------------------------------------------------------------
-- 5. Tree readers do not write (ruling R8). One RESTRICTIVE policy per write
--    command on every table with a teacher write branch, except the tables in
--    section 4, whose FOR ALL blocks already cover writes. Rows the caller owns
--    stay writable (their own account, notifications and staff Sage chat).
--    Generated by `node scripts/rls-teacher-branches.mjs --emit-write-blocks`;
--    src/lib/rls-tree-reader-coverage.test.ts fails if a new teacher write
--    branch lands without one.
-- ---------------------------------------------------------------------

-- AdvisorAvailability (no owner column)
DROP POLICY IF EXISTS "advisor_availability_tree_reader_no_insert" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_tree_reader_no_insert" ON "visionquest"."AdvisorAvailability" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "advisor_availability_tree_reader_no_update" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_tree_reader_no_update" ON "visionquest"."AdvisorAvailability" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "advisor_availability_tree_reader_no_delete" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_tree_reader_no_delete" ON "visionquest"."AdvisorAvailability" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Application (own rows: "studentId")
DROP POLICY IF EXISTS "application_tree_reader_no_insert" ON "visionquest"."Application";
CREATE POLICY "application_tree_reader_no_insert" ON "visionquest"."Application" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "application_tree_reader_no_update" ON "visionquest"."Application";
CREATE POLICY "application_tree_reader_no_update" ON "visionquest"."Application" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "application_tree_reader_no_delete" ON "visionquest"."Application";
CREATE POLICY "application_tree_reader_no_delete" ON "visionquest"."Application" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- Appointment (own rows: "studentId")
DROP POLICY IF EXISTS "appointment_tree_reader_no_insert" ON "visionquest"."Appointment";
CREATE POLICY "appointment_tree_reader_no_insert" ON "visionquest"."Appointment" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "appointment_tree_reader_no_update" ON "visionquest"."Appointment";
CREATE POLICY "appointment_tree_reader_no_update" ON "visionquest"."Appointment" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "appointment_tree_reader_no_delete" ON "visionquest"."Appointment";
CREATE POLICY "appointment_tree_reader_no_delete" ON "visionquest"."Appointment" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- CampaignStep (no owner column)
DROP POLICY IF EXISTS "campaign_step_tree_reader_no_insert" ON "visionquest"."CampaignStep";
CREATE POLICY "campaign_step_tree_reader_no_insert" ON "visionquest"."CampaignStep" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "campaign_step_tree_reader_no_update" ON "visionquest"."CampaignStep";
CREATE POLICY "campaign_step_tree_reader_no_update" ON "visionquest"."CampaignStep" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "campaign_step_tree_reader_no_delete" ON "visionquest"."CampaignStep";
CREATE POLICY "campaign_step_tree_reader_no_delete" ON "visionquest"."CampaignStep" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- CareerAssessmentSnapshot (own rows: "studentId")
DROP POLICY IF EXISTS "career_assessment_snapshot_tree_reader_no_insert" ON "visionquest"."CareerAssessmentSnapshot";
CREATE POLICY "career_assessment_snapshot_tree_reader_no_insert" ON "visionquest"."CareerAssessmentSnapshot" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "career_assessment_snapshot_tree_reader_no_update" ON "visionquest"."CareerAssessmentSnapshot";
CREATE POLICY "career_assessment_snapshot_tree_reader_no_update" ON "visionquest"."CareerAssessmentSnapshot" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "career_assessment_snapshot_tree_reader_no_delete" ON "visionquest"."CareerAssessmentSnapshot";
CREATE POLICY "career_assessment_snapshot_tree_reader_no_delete" ON "visionquest"."CareerAssessmentSnapshot" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- CareerCampaign (own rows: "studentId")
DROP POLICY IF EXISTS "career_campaign_tree_reader_no_insert" ON "visionquest"."CareerCampaign";
CREATE POLICY "career_campaign_tree_reader_no_insert" ON "visionquest"."CareerCampaign" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "career_campaign_tree_reader_no_update" ON "visionquest"."CareerCampaign";
CREATE POLICY "career_campaign_tree_reader_no_update" ON "visionquest"."CareerCampaign" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "career_campaign_tree_reader_no_delete" ON "visionquest"."CareerCampaign";
CREATE POLICY "career_campaign_tree_reader_no_delete" ON "visionquest"."CareerCampaign" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- CareerEvent (no owner column)
DROP POLICY IF EXISTS "career_event_tree_reader_no_insert" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_tree_reader_no_insert" ON "visionquest"."CareerEvent" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "career_event_tree_reader_no_update" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_tree_reader_no_update" ON "visionquest"."CareerEvent" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "career_event_tree_reader_no_delete" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_tree_reader_no_delete" ON "visionquest"."CareerEvent" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- CaseNote (own rows: "studentId")
DROP POLICY IF EXISTS "case_note_tree_reader_no_insert" ON "visionquest"."CaseNote";
CREATE POLICY "case_note_tree_reader_no_insert" ON "visionquest"."CaseNote" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "case_note_tree_reader_no_update" ON "visionquest"."CaseNote";
CREATE POLICY "case_note_tree_reader_no_update" ON "visionquest"."CaseNote" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "case_note_tree_reader_no_delete" ON "visionquest"."CaseNote";
CREATE POLICY "case_note_tree_reader_no_delete" ON "visionquest"."CaseNote" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- CertRequirement (no owner column)
DROP POLICY IF EXISTS "cert_requirement_tree_reader_no_insert" ON "visionquest"."CertRequirement";
CREATE POLICY "cert_requirement_tree_reader_no_insert" ON "visionquest"."CertRequirement" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "cert_requirement_tree_reader_no_update" ON "visionquest"."CertRequirement";
CREATE POLICY "cert_requirement_tree_reader_no_update" ON "visionquest"."CertRequirement" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "cert_requirement_tree_reader_no_delete" ON "visionquest"."CertRequirement";
CREATE POLICY "cert_requirement_tree_reader_no_delete" ON "visionquest"."CertRequirement" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Certification (own rows: "studentId")
DROP POLICY IF EXISTS "certification_tree_reader_no_insert" ON "visionquest"."Certification";
CREATE POLICY "certification_tree_reader_no_insert" ON "visionquest"."Certification" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "certification_tree_reader_no_update" ON "visionquest"."Certification";
CREATE POLICY "certification_tree_reader_no_update" ON "visionquest"."Certification" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "certification_tree_reader_no_delete" ON "visionquest"."Certification";
CREATE POLICY "certification_tree_reader_no_delete" ON "visionquest"."Certification" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ClassRequirement (no owner column)
DROP POLICY IF EXISTS "class_requirement_tree_reader_no_insert" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_tree_reader_no_insert" ON "visionquest"."ClassRequirement" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "class_requirement_tree_reader_no_update" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_tree_reader_no_update" ON "visionquest"."ClassRequirement" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "class_requirement_tree_reader_no_delete" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_tree_reader_no_delete" ON "visionquest"."ClassRequirement" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- CoachingArc (own rows: "studentId")
DROP POLICY IF EXISTS "coaching_arc_tree_reader_no_insert" ON "visionquest"."CoachingArc";
CREATE POLICY "coaching_arc_tree_reader_no_insert" ON "visionquest"."CoachingArc" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "coaching_arc_tree_reader_no_update" ON "visionquest"."CoachingArc";
CREATE POLICY "coaching_arc_tree_reader_no_update" ON "visionquest"."CoachingArc" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "coaching_arc_tree_reader_no_delete" ON "visionquest"."CoachingArc";
CREATE POLICY "coaching_arc_tree_reader_no_delete" ON "visionquest"."CoachingArc" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- Connection (own rows: "studentId")
DROP POLICY IF EXISTS "connection_tree_reader_no_insert" ON "visionquest"."Connection";
CREATE POLICY "connection_tree_reader_no_insert" ON "visionquest"."Connection" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "connection_tree_reader_no_update" ON "visionquest"."Connection";
CREATE POLICY "connection_tree_reader_no_update" ON "visionquest"."Connection" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "connection_tree_reader_no_delete" ON "visionquest"."Connection";
CREATE POLICY "connection_tree_reader_no_delete" ON "visionquest"."Connection" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ConnectionEvent (no owner column)
DROP POLICY IF EXISTS "connection_event_tree_reader_no_insert" ON "visionquest"."ConnectionEvent";
CREATE POLICY "connection_event_tree_reader_no_insert" ON "visionquest"."ConnectionEvent" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "connection_event_tree_reader_no_update" ON "visionquest"."ConnectionEvent";
CREATE POLICY "connection_event_tree_reader_no_update" ON "visionquest"."ConnectionEvent" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "connection_event_tree_reader_no_delete" ON "visionquest"."ConnectionEvent";
CREATE POLICY "connection_event_tree_reader_no_delete" ON "visionquest"."ConnectionEvent" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- ConsentRecord (own rows: "studentId")
DROP POLICY IF EXISTS "consent_record_tree_reader_no_insert" ON "visionquest"."ConsentRecord";
CREATE POLICY "consent_record_tree_reader_no_insert" ON "visionquest"."ConsentRecord" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "consent_record_tree_reader_no_update" ON "visionquest"."ConsentRecord";
CREATE POLICY "consent_record_tree_reader_no_update" ON "visionquest"."ConsentRecord" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "consent_record_tree_reader_no_delete" ON "visionquest"."ConsentRecord";
CREATE POLICY "consent_record_tree_reader_no_delete" ON "visionquest"."ConsentRecord" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- CoverLetter (own rows: "studentId")
DROP POLICY IF EXISTS "cover_letter_tree_reader_no_insert" ON "visionquest"."CoverLetter";
CREATE POLICY "cover_letter_tree_reader_no_insert" ON "visionquest"."CoverLetter" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "cover_letter_tree_reader_no_update" ON "visionquest"."CoverLetter";
CREATE POLICY "cover_letter_tree_reader_no_update" ON "visionquest"."CoverLetter" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "cover_letter_tree_reader_no_delete" ON "visionquest"."CoverLetter";
CREATE POLICY "cover_letter_tree_reader_no_delete" ON "visionquest"."CoverLetter" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- DocumentChunk (no owner column)
DROP POLICY IF EXISTS "document_chunk_tree_reader_no_insert" ON "visionquest"."DocumentChunk";
CREATE POLICY "document_chunk_tree_reader_no_insert" ON "visionquest"."DocumentChunk" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "document_chunk_tree_reader_no_update" ON "visionquest"."DocumentChunk";
CREATE POLICY "document_chunk_tree_reader_no_update" ON "visionquest"."DocumentChunk" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "document_chunk_tree_reader_no_delete" ON "visionquest"."DocumentChunk";
CREATE POLICY "document_chunk_tree_reader_no_delete" ON "visionquest"."DocumentChunk" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Employer (no owner column)
DROP POLICY IF EXISTS "employer_tree_reader_no_insert" ON "visionquest"."Employer";
CREATE POLICY "employer_tree_reader_no_insert" ON "visionquest"."Employer" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "employer_tree_reader_no_update" ON "visionquest"."Employer";
CREATE POLICY "employer_tree_reader_no_update" ON "visionquest"."Employer" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "employer_tree_reader_no_delete" ON "visionquest"."Employer";
CREATE POLICY "employer_tree_reader_no_delete" ON "visionquest"."Employer" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- EmployerContact (no owner column)
DROP POLICY IF EXISTS "employer_contact_tree_reader_no_insert" ON "visionquest"."EmployerContact";
CREATE POLICY "employer_contact_tree_reader_no_insert" ON "visionquest"."EmployerContact" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "employer_contact_tree_reader_no_update" ON "visionquest"."EmployerContact";
CREATE POLICY "employer_contact_tree_reader_no_update" ON "visionquest"."EmployerContact" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "employer_contact_tree_reader_no_delete" ON "visionquest"."EmployerContact";
CREATE POLICY "employer_contact_tree_reader_no_delete" ON "visionquest"."EmployerContact" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- EventRegistration (own rows: "studentId")
DROP POLICY IF EXISTS "event_registration_tree_reader_no_insert" ON "visionquest"."EventRegistration";
CREATE POLICY "event_registration_tree_reader_no_insert" ON "visionquest"."EventRegistration" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "event_registration_tree_reader_no_update" ON "visionquest"."EventRegistration";
CREATE POLICY "event_registration_tree_reader_no_update" ON "visionquest"."EventRegistration" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "event_registration_tree_reader_no_delete" ON "visionquest"."EventRegistration";
CREATE POLICY "event_registration_tree_reader_no_delete" ON "visionquest"."EventRegistration" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- FormAssignment (no owner column)
DROP POLICY IF EXISTS "form_assignment_tree_reader_no_insert" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_tree_reader_no_insert" ON "visionquest"."FormAssignment" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "form_assignment_tree_reader_no_update" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_tree_reader_no_update" ON "visionquest"."FormAssignment" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "form_assignment_tree_reader_no_delete" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_tree_reader_no_delete" ON "visionquest"."FormAssignment" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- FormResponse (own rows: "studentId")
DROP POLICY IF EXISTS "form_response_tree_reader_no_insert" ON "visionquest"."FormResponse";
CREATE POLICY "form_response_tree_reader_no_insert" ON "visionquest"."FormResponse" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "form_response_tree_reader_no_update" ON "visionquest"."FormResponse";
CREATE POLICY "form_response_tree_reader_no_update" ON "visionquest"."FormResponse" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "form_response_tree_reader_no_delete" ON "visionquest"."FormResponse";
CREATE POLICY "form_response_tree_reader_no_delete" ON "visionquest"."FormResponse" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- FormSubmission (own rows: "studentId")
DROP POLICY IF EXISTS "form_submission_tree_reader_no_insert" ON "visionquest"."FormSubmission";
CREATE POLICY "form_submission_tree_reader_no_insert" ON "visionquest"."FormSubmission" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "form_submission_tree_reader_no_update" ON "visionquest"."FormSubmission";
CREATE POLICY "form_submission_tree_reader_no_update" ON "visionquest"."FormSubmission" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "form_submission_tree_reader_no_delete" ON "visionquest"."FormSubmission";
CREATE POLICY "form_submission_tree_reader_no_delete" ON "visionquest"."FormSubmission" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- FormTemplate (no owner column)
DROP POLICY IF EXISTS "form_template_tree_reader_no_insert" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_tree_reader_no_insert" ON "visionquest"."FormTemplate" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "form_template_tree_reader_no_update" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_tree_reader_no_update" ON "visionquest"."FormTemplate" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "form_template_tree_reader_no_delete" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_tree_reader_no_delete" ON "visionquest"."FormTemplate" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Goal (own rows: "studentId")
DROP POLICY IF EXISTS "goal_tree_reader_no_insert" ON "visionquest"."Goal";
CREATE POLICY "goal_tree_reader_no_insert" ON "visionquest"."Goal" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "goal_tree_reader_no_update" ON "visionquest"."Goal";
CREATE POLICY "goal_tree_reader_no_update" ON "visionquest"."Goal" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "goal_tree_reader_no_delete" ON "visionquest"."Goal";
CREATE POLICY "goal_tree_reader_no_delete" ON "visionquest"."Goal" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- GoalResourceLink (own rows: "studentId")
DROP POLICY IF EXISTS "goal_resource_link_tree_reader_no_insert" ON "visionquest"."GoalResourceLink";
CREATE POLICY "goal_resource_link_tree_reader_no_insert" ON "visionquest"."GoalResourceLink" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "goal_resource_link_tree_reader_no_update" ON "visionquest"."GoalResourceLink";
CREATE POLICY "goal_resource_link_tree_reader_no_update" ON "visionquest"."GoalResourceLink" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "goal_resource_link_tree_reader_no_delete" ON "visionquest"."GoalResourceLink";
CREATE POLICY "goal_resource_link_tree_reader_no_delete" ON "visionquest"."GoalResourceLink" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- JobClassConfig (no owner column)
DROP POLICY IF EXISTS "job_class_config_tree_reader_no_insert" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_tree_reader_no_insert" ON "visionquest"."JobClassConfig" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_class_config_tree_reader_no_update" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_tree_reader_no_update" ON "visionquest"."JobClassConfig" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_class_config_tree_reader_no_delete" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_tree_reader_no_delete" ON "visionquest"."JobClassConfig" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- JobLead (no owner column)
DROP POLICY IF EXISTS "job_lead_tree_reader_no_insert" ON "visionquest"."JobLead";
CREATE POLICY "job_lead_tree_reader_no_insert" ON "visionquest"."JobLead" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_lead_tree_reader_no_update" ON "visionquest"."JobLead";
CREATE POLICY "job_lead_tree_reader_no_update" ON "visionquest"."JobLead" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_lead_tree_reader_no_delete" ON "visionquest"."JobLead";
CREATE POLICY "job_lead_tree_reader_no_delete" ON "visionquest"."JobLead" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- JobListing (no owner column)
DROP POLICY IF EXISTS "job_listing_tree_reader_no_insert" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_tree_reader_no_insert" ON "visionquest"."JobListing" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_listing_tree_reader_no_update" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_tree_reader_no_update" ON "visionquest"."JobListing" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_listing_tree_reader_no_delete" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_tree_reader_no_delete" ON "visionquest"."JobListing" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- JobScrapeRun (no owner column)
DROP POLICY IF EXISTS "job_scrape_run_tree_reader_no_insert" ON "visionquest"."JobScrapeRun";
CREATE POLICY "job_scrape_run_tree_reader_no_insert" ON "visionquest"."JobScrapeRun" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_scrape_run_tree_reader_no_update" ON "visionquest"."JobScrapeRun";
CREATE POLICY "job_scrape_run_tree_reader_no_update" ON "visionquest"."JobScrapeRun" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_scrape_run_tree_reader_no_delete" ON "visionquest"."JobScrapeRun";
CREATE POLICY "job_scrape_run_tree_reader_no_delete" ON "visionquest"."JobScrapeRun" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- JobScrapeSourceResult (no owner column)
DROP POLICY IF EXISTS "job_scrape_source_result_tree_reader_no_insert" ON "visionquest"."JobScrapeSourceResult";
CREATE POLICY "job_scrape_source_result_tree_reader_no_insert" ON "visionquest"."JobScrapeSourceResult" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_scrape_source_result_tree_reader_no_update" ON "visionquest"."JobScrapeSourceResult";
CREATE POLICY "job_scrape_source_result_tree_reader_no_update" ON "visionquest"."JobScrapeSourceResult" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "job_scrape_source_result_tree_reader_no_delete" ON "visionquest"."JobScrapeSourceResult";
CREATE POLICY "job_scrape_source_result_tree_reader_no_delete" ON "visionquest"."JobScrapeSourceResult" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- LlmCallLog (own rows: "studentId")
DROP POLICY IF EXISTS "llm_call_log_tree_reader_no_insert" ON "visionquest"."LlmCallLog";
CREATE POLICY "llm_call_log_tree_reader_no_insert" ON "visionquest"."LlmCallLog" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "llm_call_log_tree_reader_no_update" ON "visionquest"."LlmCallLog";
CREATE POLICY "llm_call_log_tree_reader_no_update" ON "visionquest"."LlmCallLog" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "llm_call_log_tree_reader_no_delete" ON "visionquest"."LlmCallLog";
CREATE POLICY "llm_call_log_tree_reader_no_delete" ON "visionquest"."LlmCallLog" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- LmsLink (no owner column)
DROP POLICY IF EXISTS "lms_link_tree_reader_no_insert" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_tree_reader_no_insert" ON "visionquest"."LmsLink" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "lms_link_tree_reader_no_update" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_tree_reader_no_update" ON "visionquest"."LmsLink" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "lms_link_tree_reader_no_delete" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_tree_reader_no_delete" ON "visionquest"."LmsLink" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Notification (own rows: "studentId")
DROP POLICY IF EXISTS "notification_tree_reader_no_insert" ON "visionquest"."Notification";
CREATE POLICY "notification_tree_reader_no_insert" ON "visionquest"."Notification" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "notification_tree_reader_no_update" ON "visionquest"."Notification";
CREATE POLICY "notification_tree_reader_no_update" ON "visionquest"."Notification" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "notification_tree_reader_no_delete" ON "visionquest"."Notification";
CREATE POLICY "notification_tree_reader_no_delete" ON "visionquest"."Notification" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- NotificationPreference (own rows: "studentId")
DROP POLICY IF EXISTS "notification_preference_tree_reader_no_insert" ON "visionquest"."NotificationPreference";
CREATE POLICY "notification_preference_tree_reader_no_insert" ON "visionquest"."NotificationPreference" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "notification_preference_tree_reader_no_update" ON "visionquest"."NotificationPreference";
CREATE POLICY "notification_preference_tree_reader_no_update" ON "visionquest"."NotificationPreference" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "notification_preference_tree_reader_no_delete" ON "visionquest"."NotificationPreference";
CREATE POLICY "notification_preference_tree_reader_no_delete" ON "visionquest"."NotificationPreference" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- Opportunity (no owner column)
DROP POLICY IF EXISTS "opportunity_tree_reader_no_insert" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_tree_reader_no_insert" ON "visionquest"."Opportunity" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "opportunity_tree_reader_no_update" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_tree_reader_no_update" ON "visionquest"."Opportunity" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "opportunity_tree_reader_no_delete" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_tree_reader_no_delete" ON "visionquest"."Opportunity" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- OrientationProgress (own rows: "studentId")
DROP POLICY IF EXISTS "orientation_progress_tree_reader_no_insert" ON "visionquest"."OrientationProgress";
CREATE POLICY "orientation_progress_tree_reader_no_insert" ON "visionquest"."OrientationProgress" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "orientation_progress_tree_reader_no_update" ON "visionquest"."OrientationProgress";
CREATE POLICY "orientation_progress_tree_reader_no_update" ON "visionquest"."OrientationProgress" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "orientation_progress_tree_reader_no_delete" ON "visionquest"."OrientationProgress";
CREATE POLICY "orientation_progress_tree_reader_no_delete" ON "visionquest"."OrientationProgress" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- OutboundMessage (no owner column)
DROP POLICY IF EXISTS "outbound_message_tree_reader_no_insert" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_tree_reader_no_insert" ON "visionquest"."OutboundMessage" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "outbound_message_tree_reader_no_update" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_tree_reader_no_update" ON "visionquest"."OutboundMessage" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "outbound_message_tree_reader_no_delete" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_tree_reader_no_delete" ON "visionquest"."OutboundMessage" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Pathway (no owner column)
DROP POLICY IF EXISTS "pathway_tree_reader_no_insert" ON "visionquest"."Pathway";
CREATE POLICY "pathway_tree_reader_no_insert" ON "visionquest"."Pathway" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "pathway_tree_reader_no_update" ON "visionquest"."Pathway";
CREATE POLICY "pathway_tree_reader_no_update" ON "visionquest"."Pathway" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "pathway_tree_reader_no_delete" ON "visionquest"."Pathway";
CREATE POLICY "pathway_tree_reader_no_delete" ON "visionquest"."Pathway" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- PortfolioItem (own rows: "studentId")
DROP POLICY IF EXISTS "portfolio_item_tree_reader_no_insert" ON "visionquest"."PortfolioItem";
CREATE POLICY "portfolio_item_tree_reader_no_insert" ON "visionquest"."PortfolioItem" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "portfolio_item_tree_reader_no_update" ON "visionquest"."PortfolioItem";
CREATE POLICY "portfolio_item_tree_reader_no_update" ON "visionquest"."PortfolioItem" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "portfolio_item_tree_reader_no_delete" ON "visionquest"."PortfolioItem";
CREATE POLICY "portfolio_item_tree_reader_no_delete" ON "visionquest"."PortfolioItem" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ProgramDocument (no owner column)
DROP POLICY IF EXISTS "program_document_tree_reader_no_insert" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_tree_reader_no_insert" ON "visionquest"."ProgramDocument" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "program_document_tree_reader_no_update" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_tree_reader_no_update" ON "visionquest"."ProgramDocument" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "program_document_tree_reader_no_delete" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_tree_reader_no_delete" ON "visionquest"."ProgramDocument" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- Progression (own rows: "studentId")
DROP POLICY IF EXISTS "progression_tree_reader_no_insert" ON "visionquest"."Progression";
CREATE POLICY "progression_tree_reader_no_insert" ON "visionquest"."Progression" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "progression_tree_reader_no_update" ON "visionquest"."Progression";
CREATE POLICY "progression_tree_reader_no_update" ON "visionquest"."Progression" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "progression_tree_reader_no_delete" ON "visionquest"."Progression";
CREATE POLICY "progression_tree_reader_no_delete" ON "visionquest"."Progression" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ProgressionEvent (own rows: "studentId")
DROP POLICY IF EXISTS "progression_event_tree_reader_no_insert" ON "visionquest"."ProgressionEvent";
CREATE POLICY "progression_event_tree_reader_no_insert" ON "visionquest"."ProgressionEvent" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "progression_event_tree_reader_no_update" ON "visionquest"."ProgressionEvent";
CREATE POLICY "progression_event_tree_reader_no_update" ON "visionquest"."ProgressionEvent" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "progression_event_tree_reader_no_delete" ON "visionquest"."ProgressionEvent";
CREATE POLICY "progression_event_tree_reader_no_delete" ON "visionquest"."ProgressionEvent" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- PublicCredentialPage (own rows: "studentId")
DROP POLICY IF EXISTS "public_credential_page_tree_reader_no_insert" ON "visionquest"."PublicCredentialPage";
CREATE POLICY "public_credential_page_tree_reader_no_insert" ON "visionquest"."PublicCredentialPage" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "public_credential_page_tree_reader_no_update" ON "visionquest"."PublicCredentialPage";
CREATE POLICY "public_credential_page_tree_reader_no_update" ON "visionquest"."PublicCredentialPage" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "public_credential_page_tree_reader_no_delete" ON "visionquest"."PublicCredentialPage";
CREATE POLICY "public_credential_page_tree_reader_no_delete" ON "visionquest"."PublicCredentialPage" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ResumeData (own rows: "studentId")
DROP POLICY IF EXISTS "resume_data_tree_reader_no_insert" ON "visionquest"."ResumeData";
CREATE POLICY "resume_data_tree_reader_no_insert" ON "visionquest"."ResumeData" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "resume_data_tree_reader_no_update" ON "visionquest"."ResumeData";
CREATE POLICY "resume_data_tree_reader_no_update" ON "visionquest"."ResumeData" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "resume_data_tree_reader_no_delete" ON "visionquest"."ResumeData";
CREATE POLICY "resume_data_tree_reader_no_delete" ON "visionquest"."ResumeData" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- ResumeVersion (own rows: "studentId")
DROP POLICY IF EXISTS "resume_version_tree_reader_no_insert" ON "visionquest"."ResumeVersion";
CREATE POLICY "resume_version_tree_reader_no_insert" ON "visionquest"."ResumeVersion" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "resume_version_tree_reader_no_update" ON "visionquest"."ResumeVersion";
CREATE POLICY "resume_version_tree_reader_no_update" ON "visionquest"."ResumeVersion" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "resume_version_tree_reader_no_delete" ON "visionquest"."ResumeVersion";
CREATE POLICY "resume_version_tree_reader_no_delete" ON "visionquest"."ResumeVersion" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- SageSnippet (no owner column)
DROP POLICY IF EXISTS "sage_snippet_tree_reader_no_insert" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_tree_reader_no_insert" ON "visionquest"."SageSnippet" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "sage_snippet_tree_reader_no_update" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_tree_reader_no_update" ON "visionquest"."SageSnippet" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "sage_snippet_tree_reader_no_delete" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_tree_reader_no_delete" ON "visionquest"."SageSnippet" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesChecklistProgress (no owner column)
DROP POLICY IF EXISTS "spokes_checklist_progress_tree_reader_no_insert" ON "visionquest"."SpokesChecklistProgress";
CREATE POLICY "spokes_checklist_progress_tree_reader_no_insert" ON "visionquest"."SpokesChecklistProgress" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_checklist_progress_tree_reader_no_update" ON "visionquest"."SpokesChecklistProgress";
CREATE POLICY "spokes_checklist_progress_tree_reader_no_update" ON "visionquest"."SpokesChecklistProgress" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_checklist_progress_tree_reader_no_delete" ON "visionquest"."SpokesChecklistProgress";
CREATE POLICY "spokes_checklist_progress_tree_reader_no_delete" ON "visionquest"."SpokesChecklistProgress" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesClass (no owner column)
DROP POLICY IF EXISTS "spokes_class_tree_reader_no_insert" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_tree_reader_no_insert" ON "visionquest"."SpokesClass" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_class_tree_reader_no_update" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_tree_reader_no_update" ON "visionquest"."SpokesClass" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_class_tree_reader_no_delete" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_tree_reader_no_delete" ON "visionquest"."SpokesClass" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesClassInstructor (no owner column)
DROP POLICY IF EXISTS "spokes_class_instructor_tree_reader_no_insert" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_tree_reader_no_insert" ON "visionquest"."SpokesClassInstructor" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_class_instructor_tree_reader_no_update" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_tree_reader_no_update" ON "visionquest"."SpokesClassInstructor" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_class_instructor_tree_reader_no_delete" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_tree_reader_no_delete" ON "visionquest"."SpokesClassInstructor" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesEmploymentFollowUp (no owner column)
DROP POLICY IF EXISTS "spokes_employment_follow_up_tree_reader_no_insert" ON "visionquest"."SpokesEmploymentFollowUp";
CREATE POLICY "spokes_employment_follow_up_tree_reader_no_insert" ON "visionquest"."SpokesEmploymentFollowUp" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_employment_follow_up_tree_reader_no_update" ON "visionquest"."SpokesEmploymentFollowUp";
CREATE POLICY "spokes_employment_follow_up_tree_reader_no_update" ON "visionquest"."SpokesEmploymentFollowUp" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_employment_follow_up_tree_reader_no_delete" ON "visionquest"."SpokesEmploymentFollowUp";
CREATE POLICY "spokes_employment_follow_up_tree_reader_no_delete" ON "visionquest"."SpokesEmploymentFollowUp" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesModuleProgress (no owner column)
DROP POLICY IF EXISTS "spokes_module_progress_tree_reader_no_insert" ON "visionquest"."SpokesModuleProgress";
CREATE POLICY "spokes_module_progress_tree_reader_no_insert" ON "visionquest"."SpokesModuleProgress" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_module_progress_tree_reader_no_update" ON "visionquest"."SpokesModuleProgress";
CREATE POLICY "spokes_module_progress_tree_reader_no_update" ON "visionquest"."SpokesModuleProgress" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));
DROP POLICY IF EXISTS "spokes_module_progress_tree_reader_no_delete" ON "visionquest"."SpokesModuleProgress";
CREATE POLICY "spokes_module_progress_tree_reader_no_delete" ON "visionquest"."SpokesModuleProgress" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))));

-- SpokesRecord (own rows: "studentId")
DROP POLICY IF EXISTS "spokes_record_tree_reader_no_insert" ON "visionquest"."SpokesRecord";
CREATE POLICY "spokes_record_tree_reader_no_insert" ON "visionquest"."SpokesRecord" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "spokes_record_tree_reader_no_update" ON "visionquest"."SpokesRecord";
CREATE POLICY "spokes_record_tree_reader_no_update" ON "visionquest"."SpokesRecord" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "spokes_record_tree_reader_no_delete" ON "visionquest"."SpokesRecord";
CREATE POLICY "spokes_record_tree_reader_no_delete" ON "visionquest"."SpokesRecord" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- Student (own rows: "id")
DROP POLICY IF EXISTS "student_tree_reader_no_insert" ON "visionquest"."Student";
CREATE POLICY "student_tree_reader_no_insert" ON "visionquest"."Student" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "id" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_tree_reader_no_update" ON "visionquest"."Student";
CREATE POLICY "student_tree_reader_no_update" ON "visionquest"."Student" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "id" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "id" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_tree_reader_no_delete" ON "visionquest"."Student";
CREATE POLICY "student_tree_reader_no_delete" ON "visionquest"."Student" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "id" = current_setting('app.current_user_id', true));

-- StudentClassEnrollment (own rows: "studentId")
DROP POLICY IF EXISTS "student_class_enrollment_tree_reader_no_insert" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_tree_reader_no_insert" ON "visionquest"."StudentClassEnrollment" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_class_enrollment_tree_reader_no_update" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_tree_reader_no_update" ON "visionquest"."StudentClassEnrollment" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_class_enrollment_tree_reader_no_delete" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_tree_reader_no_delete" ON "visionquest"."StudentClassEnrollment" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- StudentSavedJob (own rows: "studentId")
DROP POLICY IF EXISTS "student_saved_job_tree_reader_no_insert" ON "visionquest"."StudentSavedJob";
CREATE POLICY "student_saved_job_tree_reader_no_insert" ON "visionquest"."StudentSavedJob" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_saved_job_tree_reader_no_update" ON "visionquest"."StudentSavedJob";
CREATE POLICY "student_saved_job_tree_reader_no_update" ON "visionquest"."StudentSavedJob" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_saved_job_tree_reader_no_delete" ON "visionquest"."StudentSavedJob";
CREATE POLICY "student_saved_job_tree_reader_no_delete" ON "visionquest"."StudentSavedJob" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- StudentTask (own rows: "studentId")
DROP POLICY IF EXISTS "student_task_tree_reader_no_insert" ON "visionquest"."StudentTask";
CREATE POLICY "student_task_tree_reader_no_insert" ON "visionquest"."StudentTask" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_task_tree_reader_no_update" ON "visionquest"."StudentTask";
CREATE POLICY "student_task_tree_reader_no_update" ON "visionquest"."StudentTask" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_task_tree_reader_no_delete" ON "visionquest"."StudentTask";
CREATE POLICY "student_task_tree_reader_no_delete" ON "visionquest"."StudentTask" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- StudentWorkProfile (own rows: "studentId")
DROP POLICY IF EXISTS "student_work_profile_tree_reader_no_insert" ON "visionquest"."StudentWorkProfile";
CREATE POLICY "student_work_profile_tree_reader_no_insert" ON "visionquest"."StudentWorkProfile" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_work_profile_tree_reader_no_update" ON "visionquest"."StudentWorkProfile";
CREATE POLICY "student_work_profile_tree_reader_no_update" ON "visionquest"."StudentWorkProfile" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "student_work_profile_tree_reader_no_delete" ON "visionquest"."StudentWorkProfile";
CREATE POLICY "student_work_profile_tree_reader_no_delete" ON "visionquest"."StudentWorkProfile" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));

-- VisionBoardItem (own rows: "studentId")
DROP POLICY IF EXISTS "vision_board_item_tree_reader_no_insert" ON "visionquest"."VisionBoardItem";
CREATE POLICY "vision_board_item_tree_reader_no_insert" ON "visionquest"."VisionBoardItem" AS RESTRICTIVE FOR INSERT TO vq_app
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "vision_board_item_tree_reader_no_update" ON "visionquest"."VisionBoardItem";
CREATE POLICY "vision_board_item_tree_reader_no_update" ON "visionquest"."VisionBoardItem" AS RESTRICTIVE FOR UPDATE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true))
  WITH CHECK (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
DROP POLICY IF EXISTS "vision_board_item_tree_reader_no_delete" ON "visionquest"."VisionBoardItem";
CREATE POLICY "vision_board_item_tree_reader_no_delete" ON "visionquest"."VisionBoardItem" AS RESTRICTIVE FOR DELETE TO vq_app
  USING (NOT (SELECT visionquest.is_tree_reader(current_setting('app.current_user_id', true))) OR "studentId" = current_setting('app.current_user_id', true));
