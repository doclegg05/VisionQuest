-- VQ-R-018: one class's scrape must not overwrite another's rows.
-- JobListing.sourceId was globally unique, so when two class configurations
-- scraped the same upstream posting, the second class's upsert captured the
-- first class's row (rewriting its classConfigId and batch). The key becomes
-- compound (classConfigId, sourceId): strictly weaker than the old global
-- unique, so every existing row already satisfies it — no data change.

DROP INDEX "visionquest"."JobListing_sourceId_key";

CREATE UNIQUE INDEX "JobListing_classConfigId_sourceId_key"
  ON "visionquest"."JobListing"("classConfigId", "sourceId");
