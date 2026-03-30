CREATE TABLE "visionquest"."SageSnippet" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SageSnippet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SageSnippet_isActive_idx" ON "visionquest"."SageSnippet"("isActive");
