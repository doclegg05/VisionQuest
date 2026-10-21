-- CreateEnum
CREATE TYPE "visionquest"."DemoAccountKind" AS ENUM ('student', 'instructor');

-- AlterTable
ALTER TABLE "visionquest"."Student" ADD COLUMN     "demoAccount" "visionquest"."DemoAccountKind";

-- CreateIndex
CREATE INDEX "Student_demoAccount_createdAt_idx" ON "visionquest"."Student"("demoAccount", "createdAt");

