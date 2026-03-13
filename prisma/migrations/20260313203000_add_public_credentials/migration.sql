-- CreateTable
CREATE TABLE "visionquest"."PublicCredentialPage" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicCredentialPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicCredentialPage_studentId_key" ON "visionquest"."PublicCredentialPage"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicCredentialPage_slug_key" ON "visionquest"."PublicCredentialPage"("slug");

-- AddForeignKey
ALTER TABLE "visionquest"."PublicCredentialPage"
ADD CONSTRAINT "PublicCredentialPage_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
