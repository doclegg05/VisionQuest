-- AlterTable
ALTER TABLE "visionquest"."Appointment"
ADD COLUMN "bookingSource" TEXT NOT NULL DEFAULT 'teacher',
ADD COLUMN "confirmationSentAt" TIMESTAMP(3),
ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "visionquest"."AdvisorAvailability" (
    "id" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "locationType" TEXT NOT NULL DEFAULT 'virtual',
    "locationLabel" TEXT,
    "meetingUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvisorAvailability_advisorId_weekday_active_idx"
ON "visionquest"."AdvisorAvailability"("advisorId", "weekday", "active");

-- AddForeignKey
ALTER TABLE "visionquest"."AdvisorAvailability"
ADD CONSTRAINT "AdvisorAvailability_advisorId_fkey"
FOREIGN KEY ("advisorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
