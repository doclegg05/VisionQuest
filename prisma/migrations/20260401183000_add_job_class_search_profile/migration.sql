ALTER TABLE "visionquest"."JobClassConfig"
ADD COLUMN "targetRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "excludedEmployers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "remoteOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wageFloor" DOUBLE PRECISION;

ALTER TABLE "visionquest"."JobClassConfig"
ALTER COLUMN "sources" SET DEFAULT ARRAY['careeronestop']::TEXT[];
