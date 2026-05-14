-- Track Job Scout scrape runs and per-source results so refreshes can be
-- processed asynchronously while teachers see durable operational status.

CREATE TABLE "visionquest"."JobScrapeRun" (
  "id" TEXT NOT NULL,
  "classConfigId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "requestedById" TEXT,
  "backgroundJobId" TEXT,
  "totalSources" INTEGER NOT NULL DEFAULT 0,
  "completedSources" INTEGER NOT NULL DEFAULT 0,
  "failedSources" INTEGER NOT NULL DEFAULT 0,
  "totalFetched" INTEGER NOT NULL DEFAULT 0,
  "totalUpserted" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobScrapeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."JobScrapeSourceResult" (
  "id" TEXT NOT NULL,
  "scrapeRunId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "upsertedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobScrapeSourceResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobScrapeRun_classConfigId_status_createdAt_idx"
  ON "visionquest"."JobScrapeRun" ("classConfigId", "status", "createdAt");

CREATE INDEX "JobScrapeRun_status_createdAt_idx"
  ON "visionquest"."JobScrapeRun" ("status", "createdAt");

CREATE INDEX "JobScrapeRun_backgroundJobId_idx"
  ON "visionquest"."JobScrapeRun" ("backgroundJobId");

CREATE UNIQUE INDEX "JobScrapeSourceResult_scrapeRunId_source_key"
  ON "visionquest"."JobScrapeSourceResult" ("scrapeRunId", "source");

CREATE INDEX "JobScrapeSourceResult_source_status_idx"
  ON "visionquest"."JobScrapeSourceResult" ("source", "status");

ALTER TABLE "visionquest"."JobScrapeRun"
  ADD CONSTRAINT "JobScrapeRun_classConfigId_fkey"
  FOREIGN KEY ("classConfigId") REFERENCES "visionquest"."JobClassConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."JobScrapeSourceResult"
  ADD CONSTRAINT "JobScrapeSourceResult_scrapeRunId_fkey"
  FOREIGN KEY ("scrapeRunId") REFERENCES "visionquest"."JobScrapeRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."JobScrapeRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."JobScrapeSourceResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_scrape_run_access" ON "visionquest"."JobScrapeRun"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
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
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  );

CREATE POLICY "job_scrape_source_result_access" ON "visionquest"."JobScrapeSourceResult"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."JobScrapeRun" jsr
      JOIN "visionquest"."JobClassConfig" jcc ON jcc.id = jsr."classConfigId"
      WHERE jsr.id = "scrapeRunId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."JobScrapeRun" jsr
      JOIN "visionquest"."JobClassConfig" jcc ON jcc.id = jsr."classConfigId"
      WHERE jsr.id = "scrapeRunId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  );
