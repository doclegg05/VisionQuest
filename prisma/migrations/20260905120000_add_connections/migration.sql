-- AlterTable
ALTER TABLE "visionquest"."ResumeVersion" ADD COLUMN     "jobLeadId" TEXT,
ALTER COLUMN "jobListingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visionquest"."CoverLetter" ADD COLUMN     "jobLeadId" TEXT,
ALTER COLUMN "jobListingId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visionquest"."Appointment" ADD COLUMN     "externalAttendee" JSONB;

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
CREATE UNIQUE INDEX "Connection_studentId_jobLeadId_key" ON "visionquest"."Connection"("studentId", "jobLeadId");

-- CreateIndex
CREATE INDEX "ConnectionEvent_connectionId_at_idx" ON "visionquest"."ConnectionEvent"("connectionId", "at");

-- CreateIndex
CREATE INDEX "OutboundMessage_connectionId_sentAt_idx" ON "visionquest"."OutboundMessage"("connectionId", "sentAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_toKind_toId_sentAt_idx" ON "visionquest"."OutboundMessage"("toKind", "toId", "sentAt");

-- CreateIndex
CREATE INDEX "ResumeVersion_jobLeadId_idx" ON "visionquest"."ResumeVersion"("jobLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_studentId_jobLeadId_version_key" ON "visionquest"."ResumeVersion"("studentId", "jobLeadId", "version");

-- CreateIndex
CREATE INDEX "CoverLetter_jobLeadId_idx" ON "visionquest"."CoverLetter"("jobLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverLetter_studentId_jobLeadId_version_key" ON "visionquest"."CoverLetter"("studentId", "jobLeadId", "version");

-- AddForeignKey
ALTER TABLE "visionquest"."ResumeVersion" ADD CONSTRAINT "ResumeVersion_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CoverLetter" ADD CONSTRAINT "CoverLetter_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "visionquest"."JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "visionquest"."Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "visionquest"."ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_interviewAppointmentId_fkey" FOREIGN KEY ("interviewAppointmentId") REFERENCES "visionquest"."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Connection" ADD CONSTRAINT "Connection_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "visionquest"."Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "visionquest"."Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OutboundMessage" ADD CONSTRAINT "OutboundMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "visionquest"."Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Row-level security — Match & Connect Phase 4 (Task 4.1)
-- ---------------------------------------------------------------------------
-- A Connection is the object that causes a student's information to leave this
-- program, so its policies are split by command rather than written as one
-- FOR ALL: the student's read, the student's two legal writes, and the staff
-- branch each need a different predicate, and a single FOR ALL policy would
-- put the read predicate into the write path (the mistake job_lead_read was
-- split to avoid in 20260905110000).
--
-- ConnectionEvent has SELECT and INSERT policies and NOTHING else: an audit
-- trail that can be updated or deleted is not one.
--
-- The employer has no session and no account here, so employer-driven
-- transitions (view, interested, not now, hired) are written through
-- `prismaAdmin` inside the bounded helper src/lib/connect/employer-link.ts,
-- which resolves a hashed token to exactly one Connection and touches nothing
-- else. That is a deliberate, single, reviewed bypass — not a policy branch,
-- because there is no session attribute a policy could key on.

-- ---- Connection ----
ALTER TABLE "visionquest"."Connection" ENABLE ROW LEVEL SECURITY;

-- Read: the student's own rows, plus staff — teachers only for students they
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
-- (design spec §6 step 1: "a student asks Sage 'I want the Production
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
-- row only INTO 'student_approved' or 'withdrawn' — USING gates the row they
-- may touch, WITH CHECK gates the row they may leave behind, so the two
-- transitions the design allows them are enforced by the database and not
-- only by assertStudentTransition() in the app.
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

-- No DELETE policy: a connection is a disclosure record. It is closed or
-- withdrawn, never removed.
GRANT SELECT, INSERT, UPDATE ON "visionquest"."Connection" TO vq_app;

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

-- Deliberately NO update or delete policy. With RLS enabled and no policy for
-- a command, no row is ever matched, so every UPDATE and DELETE affects zero
-- rows — for every role, admin included. THAT is what makes this table
-- append-only.
--
-- The narrower GRANT below is documentation, not the mechanism: the baseline's
-- ALTER DEFAULT PRIVILEGES already grants vq_app SELECT/INSERT/UPDATE/DELETE
-- on every table created in this schema, so it takes nothing away. Do not
-- "harden" this table by revoking the privilege instead of keeping the policies
-- absent — a REVOKE turns a silent zero-row result into a 42501 that callers
-- would then have to handle.
GRANT SELECT, INSERT ON "visionquest"."ConnectionEvent" TO vq_app;

-- ---- OutboundMessage (staff read only) ----
-- The log of what this program sent out. A student sees what was shared about
-- them through their own Connection rows and the /memory disclosure list, both
-- of which are built from the frozen packet — not from the rendered message
-- body, which also names the employer contact.
ALTER TABLE "visionquest"."OutboundMessage" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbound_message_access" ON "visionquest"."OutboundMessage";
CREATE POLICY "outbound_message_access" ON "visionquest"."OutboundMessage"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  )
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."OutboundMessage" TO vq_app;
