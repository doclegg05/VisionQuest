-- Performance indexes from codebase audit (2026-04-18).
-- All hot-path filters now have matching indexes; avoids seq scans on growing tables.

-- Goal: teacher dashboards and readiness computations filter on (studentId, status).
CREATE INDEX "Goal_studentId_status_idx"
  ON "visionquest"."Goal" ("studentId", "status");

-- Goal: "goals confirmed by teacher X" queries.
CREATE INDEX "Goal_confirmedBy_idx"
  ON "visionquest"."Goal" ("confirmedBy");

-- CertRequirement: joined from Certification → requirements; previously seq scan per cert.
CREATE INDEX "CertRequirement_certificationId_idx"
  ON "visionquest"."CertRequirement" ("certificationId");

-- StudentSavedJob: FK to JobListing is used for cascade delete + reverse lookups.
-- Existing @@unique([studentId, jobListingId]) indexes (studentId, jobListingId) only.
CREATE INDEX "StudentSavedJob_jobListingId_idx"
  ON "visionquest"."StudentSavedJob" ("jobListingId");

-- Pathway: filtered by active status, joined by creator on teacher views.
CREATE INDEX "Pathway_active_idx"
  ON "visionquest"."Pathway" ("active");

CREATE INDEX "Pathway_createdBy_idx"
  ON "visionquest"."Pathway" ("createdBy");
