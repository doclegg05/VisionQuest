-- Student.mustChangePassword: this account's password was issued by somebody
-- else and has not been rotated (review finding B2, 2026-09-03).
--
-- Before this column, SPOKES intake provisioned every new student with the
-- same literal password, `Spokes<currentYear>!`, against a username derived
-- from their name — and nothing anywhere recorded that the credential was
-- temporary, so nothing could ask for it back. Intake now mints a per-account
-- password from a CSPRNG and sets this flag; the login and MFA-challenge
-- responses carry it so the client can route the student to change it.
--
-- Default false, NOT NULL: every account that exists today chose its own
-- password (registration, teacher reset, or the emailed recovery link), so
-- backfilling false is the truthful value and no data change is needed.

ALTER TABLE "visionquest"."Student"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- FileUpload.contentDigest: the digest of the stored bytes as the program
-- recorded them at upload time, for /api/verify/document (bundle 4).
--
-- The verifier's job is to confirm the person presenting a document holds the
-- one that was issued. Comparing against a digest carried by the presented
-- token only confirms the token agrees with itself, which is most of what was
-- wrong with the old check. Comparing against this column compares against the
-- program's own record.
--
-- Nullable: every row that exists predates the column and has no recorded
-- digest. A verifier must read NULL as "cannot verify", never as a match.

ALTER TABLE "visionquest"."FileUpload" ADD COLUMN "contentDigest" TEXT;
