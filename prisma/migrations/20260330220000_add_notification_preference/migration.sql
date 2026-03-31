-- CreateTable
CREATE TABLE "visionquest"."NotificationPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_studentId_channel_key" ON "visionquest"."NotificationPreference"("studentId", "channel");

-- AddForeignKey
ALTER TABLE "visionquest"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
