-- Backfills the `signatureFileId` column that was declared in
-- prisma/schema.prisma on 2026-03-28 (commit ff58a4a — digital signature pad)
-- but never had a matching migration generated. The column has been missing
-- from prod for ~25 days; Prisma client crashes on any findUnique that
-- touches FormSubmission because the client expects the column to exist.
--
-- `String?` on the model maps to a nullable TEXT column. Safe additive change:
-- no data backfill required (existing rows get NULL, which matches the
-- optional semantics).

ALTER TABLE "visionquest"."FormSubmission" ADD COLUMN "signatureFileId" TEXT;
