-- AlterTable: Make passwordHash nullable for OAuth users and add authProvider field
ALTER TABLE "visionquest"."Student" ADD COLUMN     "authProvider" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;
