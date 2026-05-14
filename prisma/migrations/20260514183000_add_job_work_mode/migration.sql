ALTER TABLE "visionquest"."JobListing"
  ADD COLUMN "workMode" TEXT NOT NULL DEFAULT 'onsite';

UPDATE "visionquest"."JobListing"
SET "workMode" = CASE
  WHEN LOWER(CONCAT_WS(' ', "title", "location", "description")) ~ '\m(hybrid|partly remote|partially remote|remote/onsite|remote and onsite)\M'
    THEN 'hybrid'
  WHEN LOWER("source") IN ('remotive', 'remoteok', 'weworkremotely')
    OR (
      LOWER(CONCAT_WS(' ', "title", "location", "description")) ~ '\m(remote|work from home|work-from-home|wfh|anywhere)\M'
      AND LOWER(CONCAT_WS(' ', "title", "location", "description")) !~ '\m(no|not|non) remote\M'
    )
    THEN 'remote'
  ELSE 'onsite'
END;

ALTER TABLE "visionquest"."JobListing"
  ADD CONSTRAINT "JobListing_workMode_check"
  CHECK ("workMode" IN ('onsite', 'remote', 'hybrid'));

CREATE INDEX "JobListing_classConfigId_status_workMode_idx"
  ON "visionquest"."JobListing" ("classConfigId", "status", "workMode");
