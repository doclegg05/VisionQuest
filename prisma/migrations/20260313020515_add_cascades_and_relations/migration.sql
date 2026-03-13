-- DropForeignKey
ALTER TABLE "visionquest"."CertRequirement" DROP CONSTRAINT "CertRequirement_certificationId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."Certification" DROP CONSTRAINT "Certification_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."Conversation" DROP CONSTRAINT "Conversation_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."FileUpload" DROP CONSTRAINT "FileUpload_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."Goal" DROP CONSTRAINT "Goal_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."OrientationProgress" DROP CONSTRAINT "OrientationProgress_itemId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."OrientationProgress" DROP CONSTRAINT "OrientationProgress_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."PortfolioItem" DROP CONSTRAINT "PortfolioItem_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."Progression" DROP CONSTRAINT "Progression_studentId_fkey";

-- DropForeignKey
ALTER TABLE "visionquest"."ResumeData" DROP CONSTRAINT "ResumeData_studentId_fkey";

-- AddForeignKey
ALTER TABLE "visionquest"."Conversation" ADD CONSTRAINT "Conversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "visionquest"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Progression" ADD CONSTRAINT "Progression_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OrientationProgress" ADD CONSTRAINT "OrientationProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OrientationProgress" ADD CONSTRAINT "OrientationProgress_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "visionquest"."OrientationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Certification" ADD CONSTRAINT "Certification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CertRequirement" ADD CONSTRAINT "CertRequirement_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "visionquest"."Certification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CertRequirement" ADD CONSTRAINT "CertRequirement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."CertTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."PortfolioItem" ADD CONSTRAINT "PortfolioItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ResumeData" ADD CONSTRAINT "ResumeData_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FileUpload" ADD CONSTRAINT "FileUpload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
