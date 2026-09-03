-- Student.googleId: the Google OIDC `sub` claim, bound to an account on its
-- first verified Google sign-in (review finding F9 / SEC-01, 2026-09-01).
-- Before this column the OAuth callback matched accounts by email alone, so
-- any Google account presenting a staff address could sign in as that staff
-- member. The callback now matches by "googleId" first; a verified email may
-- link only an account whose "googleId" is still NULL, and a different bound
-- "googleId" is refused. Nullable: password-only accounts never get one.
-- Unique: one Google identity maps to at most one account. No data change:
-- existing Google accounts have no stored `sub` and receive it on their next
-- verified sign-in through the linking path.

ALTER TABLE "visionquest"."Student" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "Student_googleId_key" ON "visionquest"."Student"("googleId");
