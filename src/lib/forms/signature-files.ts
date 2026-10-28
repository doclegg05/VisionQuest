import { prisma } from "@/lib/db";

/**
 * True when the FileUpload `fileId` exists and is owned by `studentId`.
 * Callers use this to reject a client-supplied file id that points at another
 * student's upload before any write happens.
 */
export async function fileBelongsToStudent(fileId: string, studentId: string): Promise<boolean> {
  const row = await prisma.fileUpload.findFirst({
    where: { id: fileId, studentId },
    select: { id: true },
  });
  return !!row;
}
