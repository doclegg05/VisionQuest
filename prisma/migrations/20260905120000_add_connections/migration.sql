-- AlterTable
ALTER TABLE "visionquest"."ResumeVersion" ADD COLUMN     "jobLeadId" TEXT,
ALTER COLUMN "jobListingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visionquest"."CoverLetter" ADD COLUMN     "jobLeadId" TEXT,
ALTER COLUMN "jobListingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visionquest"."Appointment" ADD COLUMN     "externalAttendee" JSONB;

-- AlterTable
ALTER TABLE "visionquest"."Opportunity" ADD COLUMN     "sourceJobLeadId" TEXT;

-- CreateTable
CREATE TABLE "visionquest"."Connection" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "jobLeadId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedVia" TEXT NOT NULL DEFAULT 'teacher',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentRecordId" TEXT,
    "packet" JSONB,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "employerTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenContactId" TEXT,
    "employerViewedAt" TIMESTAMP(3),
    "employerRespondedAt" TIMESTAMP(3),
    "employerResponse" TEXT,
    "responseReason" TEXT,
    "interviewAppointmentId" TEXT,
    "hiredAt" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "hourlyWage" DOUBLE PRECISION,
    "applicationId" TEXT,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "classId" TEXT,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ConnectionEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."OutboundMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "toKind" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "providerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "connectionId" TEXT,
    "employerId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_employerTokenHash_key" ON "visionquest"."Connection"("employerTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_applicationId_key" ON "visionquest"."Connection"("applicationId");

-- CreateIndex
CREATE INDEX "Connection_studentId_status_idx" ON "visionquest"."Connection"("studentId", "status");

-- CreateIndex
CREATE INDEX "Connection_employerId_status_idx" ON "visionquest"."Connection"("employerId", "status");

-- CreateIndex
CREATE INDEX "Connection_status_statusChangedAt_idx" ON "visionquest"."Connection"("status", "statusChangedAt");

-- CreateIndex
CREATE INDEX "Connection_jobLeadId_status_idx" ON "visionquest"."Connection"("jobLeadId", "status");

-- CreateIndex
CREATE INDEX "Connection_classId_status_idx" ON "visionquest"."Connection"("classId", "status");

-- CreateIndex
CREATE INDEX "Connection_proposedById_idx" ON "visionquest"."Connection"("proposedById");

-- CreateIndex
CREATE INDEX "Connection_sentById_idx" ON "visionquest"."Connection"("sentById");

-- CreateIndex
CREATE INDEX "Connection_consentRecordId_idx" ON "visionquest"."Connection"("consentRecordId");

-- CreateIndex
CREATE INDEX "Connection_interviewAppointmentId_idx" ON "visionquest"."Connection"("interviewAppointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_studentId_jobLeadId_key" ON "visionquest"."Connection"("studentId", "jobLeadId");

-- CreateIndex
CREATE INDEX "ConnectionEvent_connectionId_at_idx" ON "visionquest"."ConnectionEvent"("connectionId", "at");

-- CreateIndex
CREATE INDEX "OutboundMessage_connectionId_sentAt_idx" ON "visionquest"."OutboundMessage"("connectionId", "sentAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_toKind_toId_sentAt_idx" ON "visionquest"."OutboundMessage"("toKind", "toId", "sentAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_employerId_sentAt_idx" ON "visionquest"."OutboundMessage"("employerId", "sentAt");

-- CreateIndex
CREATE INDEX "ResumeVersion_jobLeadId_idx" ON "visionquest"."ResumeVersion"("jobLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_studentId_jobLeadId_version_key" ON "visionquest"."ResumeVersion"("studentId", "jobLeadId", "version");

-- CreateIndex
CREATE INDEX "CoverLetter_jobLeadId_idx" ON "visionquest"."CoverLetter"("jobLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverLetter_studentId_jobLeadId_version_key" ON "visionquest"."CoverLetter"("studentId", "jobLeadId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_sourceJobLeadId_key" ON "visionquest"."Opportunity"("sourceJobLeadId");

-- AddForeignKey
ALTER TABLE "visionquest"."ResumeVersion" ADD CONSTRAINT "ResumeVersion_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CoverLetter" ADD CONSTRAINT "CoverLetter_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "visionquest"."Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "visionquest"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "visionquest"."ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_interviewAppointmentId_fkey" FOREIGN KEY ("interviewAppointmentId") REFERENCES "visionquest"."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visionquest"."Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "visionquest"."Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OutboundMessage" ADD CONSTRAINT "OutboundMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "visionquest"."Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Exactly one opening per tailored document
-- ---------------------------------------------------------------------------
-- `ResumeVersion` and `CoverLetter` now carry two nullable FKs: one to a
-- scraped `JobListing`, one to a Match & Connect `JobLead`. Making
-- `jobListingId` nullable is what lets a lead-tailored resume exist at all,
-- and it also lets a row belong to NEITHER opening, or to both.
--
-- Both are wrong, and both are silent. A row with neither key is invisible to
-- every packet and every application view -- it looks like the tailoring
-- simply did not happen. A row with both keys is counted twice and makes the
-- two @@unique(studentId, <key>, version) pairs disagree about the next
-- version number. The CHECK makes both unrepresentable for every writer,
-- including one that never reads src/lib/sage/agent/tailor-application.ts.
--
-- NOT VALID is deliberate: every existing row predates `jobLeadId` and so
-- already satisfies the constraint, and skipping the validation scan keeps the
-- deploy from holding the table longer than the catalog write needs.
ALTER TABLE "visionquest"."ResumeVersion"
  ADD CONSTRAINT "ResumeVersion_one_opening"
  CHECK (("jobListingId" IS NULL) <> ("jobLeadId" IS NULL)) NOT VALID;

ALTER TABLE "visionquest"."CoverLetter"
  ADD CONSTRAINT "CoverLetter_one_opening"
  CHECK (("jobListingId" IS NULL) <> ("jobLeadId" IS NULL)) NOT VALID;

-- ---------------------------------------------------------------------------
-- Row-level security -- Match & Connect Phase 4 (Task 4.1)
-- ---------------------------------------------------------------------------
-- A Connection is the object that causes a student's information to leave this
-- program, so its policies are split by command rather than written as one
-- FOR ALL: the student's read, the student's two legal writes, and the staff
-- branch each need a different predicate, and a single FOR ALL policy would
-- put the read predicate into the write path (the mistake job_lead_read was
-- split to avoid in 20260905110000).
--
-- ConnectionEvent and OutboundMessage have SELECT and INSERT policies and
-- NOTHING else, and their UPDATE/DELETE privileges are revoked on top of that:
-- a record of what left the program is not one if it can be edited afterwards.
--
-- The employer has no session and no account here, so employer-driven
-- transitions (view, interested, not now, hired) are written through
-- `prismaAdmin` inside the bounded helper src/lib/connect/employer-link.ts,
-- which resolves a hashed token to exactly one Connection and touches nothing
-- else. That is a deliberate, single, reviewed bypass -- not a policy branch,
-- because there is no session attribute a policy could key on.

-- ---- Connection ----
ALTER TABLE "visionquest"."Connection" ENABLE ROW LEVEL SECURITY;

-- Read: the student's own rows, plus staff -- teachers only for students they
-- actually manage (managed_student_ids), the same gate StudentAlert uses.
DROP POLICY IF EXISTS "connection_read" ON "visionquest"."Connection";
CREATE POLICY "connection_read" ON "visionquest"."Connection"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- Insert: staff for a student they manage, and a student for THEMSELVES in
-- the 'proposed' state only.
--
-- The student branch exists because `propose_connection` is a student tool
-- (design spec section 6 step 1: "a student asks Sage 'I want the Production
-- Associate one'"). Without it that tool could only work through an admin
-- client, which would turn a student-initiated write into an RLS bypass. The
-- branch is bounded three ways instead: the row must be theirs, it must start
-- at 'proposed', and the unique (studentId, jobLeadId) means one row per lead.
-- A proposal is not an approval and sends nothing.
DROP POLICY IF EXISTS "connection_insert" ON "visionquest"."Connection";
CREATE POLICY "connection_insert" ON "visionquest"."Connection"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_user_id', true)
      AND "status" = 'proposed'
    )
  );

-- Update: staff freely within their managed set. A STUDENT may move their own
-- row only INTO 'student_approved' or 'withdrawn' -- USING gates the row they
-- may touch, WITH CHECK gates the row they may leave behind, so the two
-- transitions the design allows them are enforced by the database and not only
-- by assertStudentTransition() in the app.
--
-- WHAT THIS POLICY DOES NOT DO, stated plainly because the opposite is easy to
-- assume: RLS is row-level, never column-level. A student whose UPDATE lands
-- on a permitted row and leaves a permitted status behind may change ANY other
-- column in the same statement -- including `packet`, the frozen record of
-- exactly what they agreed to share. Postgres has no role-conditional column
-- privilege that would help: column GRANTs are per database role, and vq_app
-- is every application role at once.
--
-- So the packet's immutability is an APPLICATION invariant, not a database
-- one. The approve route builds the packet itself from server-side data and
-- never accepts one from the request body, and src/lib/rls.test.ts pins the
-- fact that the database alone would allow the rewrite, so nobody later reads
-- this policy and concludes the column is protected here.
DROP POLICY IF EXISTS "connection_update" ON "visionquest"."Connection";
CREATE POLICY "connection_update" ON "visionquest"."Connection"
  FOR UPDATE TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_user_id', true)
      AND "status" IN ('student_approved', 'withdrawn')
    )
  );

-- No DELETE policy AND no DELETE privilege: a connection is a disclosure
-- record. It is closed or withdrawn, never removed. The two guards do
-- different jobs -- the missing policy makes a delete match zero rows, the
-- missing privilege makes it fail loudly with 42501 -- and the loud one is
-- what a caller needs, because "deleted 0 rows" reads like "there was nothing
-- to delete".
GRANT SELECT, INSERT, UPDATE ON "visionquest"."Connection" TO vq_app;
REVOKE DELETE ON "visionquest"."Connection" FROM vq_app;

-- ---- ConnectionEvent (append-only) ----
ALTER TABLE "visionquest"."ConnectionEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connection_event_read" ON "visionquest"."ConnectionEvent";
CREATE POLICY "connection_event_read" ON "visionquest"."ConnectionEvent"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."Connection" c
      WHERE c."id" = "visionquest"."ConnectionEvent"."connectionId"
        AND (
          c."studentId" = current_setting('app.current_user_id', true)
          OR (
            current_setting('app.current_role', true) = 'teacher'
            AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
          )
        )
    )
  );

DROP POLICY IF EXISTS "connection_event_insert" ON "visionquest"."ConnectionEvent";
CREATE POLICY "connection_event_insert" ON "visionquest"."ConnectionEvent"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."Connection" c
      WHERE c."id" = "visionquest"."ConnectionEvent"."connectionId"
        AND (
          c."studentId" = current_setting('app.current_user_id', true)
          OR (
            current_setting('app.current_role', true) = 'teacher'
            AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
          )
        )
    )
  );

-- Append-only, guarded twice on purpose.
--
-- There is no UPDATE or DELETE policy, so with RLS enabled no row is ever
-- matched for those commands and they affect zero rows for every role, admin
-- included. On top of that the privileges are revoked, because the baseline's
-- ALTER DEFAULT PRIVILEGES grants vq_app all four verbs on every table created
-- in this schema, and a silent zero-row UPDATE is the wrong failure: a caller
-- that "edited" an audit row and got count 0 has no reason to think anything
-- went wrong. 42501 says it out loud, at the line that did it.
--
-- (An earlier revision of this file argued the opposite -- that a REVOKE turns
-- a quiet result into an error callers would then have to handle. That is
-- exactly the point: nothing in this codebase updates or deletes a
-- ConnectionEvent, so the only caller that can ever see the error is a bug.)
GRANT SELECT, INSERT ON "visionquest"."ConnectionEvent" TO vq_app;
REVOKE UPDATE, DELETE ON "visionquest"."ConnectionEvent" FROM vq_app;

-- ---- OutboundMessage (staff, scoped to the students they manage) ----
-- The log of what this program sent out. A student sees what was shared about
-- them through their own Connection rows and the /memory disclosure list, both
-- of which are built from the frozen packet -- not from the rendered message
-- body, which also names the employer contact.
--
-- SELECT and INSERT are split, and the teacher branch is scoped through the
-- parent Connection's student, for the same reason connection_read is scoped:
-- the first cut admitted any role in ('admin','teacher') to every row, which
-- made one student's message log readable by staff with no relationship to
-- them. `managed_student_ids` is the gate everywhere else; it is the gate here
-- too.
--
-- Rows with a NULL connectionId (the FK is SET NULL, and Phase 5's nudges may
-- have no connection at all) are admin-only. There is no student to scope them
-- by, and defaulting an unscoped row to "every teacher" is exactly the failure
-- this policy exists to remove.
ALTER TABLE "visionquest"."OutboundMessage" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbound_message_access" ON "visionquest"."OutboundMessage";

DROP POLICY IF EXISTS "outbound_message_read" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_read" ON "visionquest"."OutboundMessage"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND EXISTS (
        SELECT 1
        FROM "visionquest"."Connection" c
        WHERE c."id" = "visionquest"."OutboundMessage"."connectionId"
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

DROP POLICY IF EXISTS "outbound_message_insert" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_insert" ON "visionquest"."OutboundMessage"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND EXISTS (
        SELECT 1
        FROM "visionquest"."Connection" c
        WHERE c."id" = "visionquest"."OutboundMessage"."connectionId"
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

-- Same append-only shape as ConnectionEvent, and for the same reason: this is
-- the record of what left the program. It is written once, when the message is
-- sent, and never corrected afterwards.
--
-- NOTE FOR THE SMS NUDGE PATH (Phase 5): src/lib/nudges/replies.ts claims a
-- reply with `prismaAdmin.outboundMessage.updateMany`. These REVOKEs name
-- vq_app, so they do not touch that client while ADMIN_DATABASE_URL points at
-- its own role. They DO bite if that variable is unset, because prismaAdmin
-- then silently falls back to DATABASE_URL — i.e. to vq_app (finding F63). In
-- that configuration the reply claim fails loudly with 42501 instead of
-- quietly running without RLS, which is the better of the two failures but is
-- worth knowing before reading the stack trace.
GRANT SELECT, INSERT ON "visionquest"."OutboundMessage" TO vq_app;
REVOKE UPDATE, DELETE ON "visionquest"."OutboundMessage" FROM vq_app;
