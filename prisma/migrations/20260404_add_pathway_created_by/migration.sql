ALTER TABLE "visionquest"."Pathway" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "visionquest"."Pathway" ADD CONSTRAINT "Pathway_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
