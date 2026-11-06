-- Organization tree, Phase 1, Task 3: RLS follows the tree.
--
-- The app now maps both coordinator roles to the RLS role 'teacher'
-- (rlsRoleFor in src/lib/rls-headers.ts). Every teacher policy branch that
-- goes through managed_student_ids therefore scopes coordinators too, so this
-- migration widens that one function:
--
--   1. instructors: students enrolled in classes they instruct (unchanged);
--   2. regional coordinators: students enrolled in classes whose regionId is
--      one of their RegionCoordinator rows (read live, so removing the row
--      removes access on the next query);
--   3. program coordinators: every role = 'student' row.
--
-- A class with no region reaches no regional coordinator: NULL never equals a
-- RegionCoordinator.regionId. A coordinator with no RegionCoordinator rows
-- gets the empty set, not everything.
--
-- The tree widens WHO can reach a student, never WHAT they can read.
-- Instructors already read transcript tables through their teacher branch
-- (Conversation, Message, and text derived from them). Coordinators must not,
-- so section 3 adds a RESTRICTIVE policy on each of those tables that refuses
-- a tree reader (is_tree_reader) any row that is not their own. The
-- own-row carve-out keeps staff Sage chat working: a coordinator's
-- teacher_assistant conversation is stored with studentId = their own id
-- (src/lib/chat/conversation.ts, getOrCreateTeacherConversation).
--
-- Instructors, admins and students are unaffected: is_tree_reader is false
-- for them, so each restrictive policy passes and the permissive policies
-- decide exactly as before. prismaAdmin bypasses RLS and is unaffected.

-- ---------------------------------------------------------------------
-- 1. managed_student_ids: add the region and program-coordinator arms.
--    The parameter keeps its original name: CREATE OR REPLACE cannot
--    rename an input parameter, and the policies depend on the function.
-- ---------------------------------------------------------------------
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
  JOIN visionquest."RegionCoordinator" rc
    ON rc."regionId" = c."regionId"
  WHERE rc."coordinatorId" = teacher_id
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn')
  UNION
  SELECT s.id
  FROM visionquest."Student" s
  WHERE s.role = 'student'
    AND EXISTS (
      SELECT 1 FROM visionquest."Student" p
      WHERE p.id = teacher_id
        AND p.role = 'program_coordinator'
    );
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

-- ---------------------------------------------------------------------
-- 2. is_tree_reader: true when the user is a regional or program
--    coordinator. SECURITY DEFINER so it can read Student.role from inside
--    a policy on any table without recursing into Student's own policies.
--    Unknown or empty ids return false.
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

GRANT EXECUTE ON FUNCTION visionquest.is_tree_reader(text) TO vq_app;

-- ---------------------------------------------------------------------
-- 3. Transcript tables refuse tree readers.
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
