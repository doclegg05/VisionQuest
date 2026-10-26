import { prisma } from "@/lib/db";

const PACKET_FORM_IDS = ["orientation-intake", "student-intake"];

export interface CohortPacketStudent {
  id: string;
  displayName: string;
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  /** Storage key of the newest archived intake packet, or null if none is on file. */
  storageKey: string | null;
}

/**
 * Reads the newest archived intake packet reference for each student. Callers
 * must already have resolved `studentIds` through the staff scope check; this
 * helper does no authorization of its own.
 */
export async function listCohortPacketStudents(
  studentIds: string[],
): Promise<CohortPacketStudent[]> {
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      displayName: true,
      studentId: true,
      spokesRecord: { select: { firstName: true, lastName: true } },
      formSubmissions: {
        where: { formId: { in: PACKET_FORM_IDS } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { fileId: true },
      },
    },
  });

  const fileIds = students
    .map((s) => s.formSubmissions[0]?.fileId)
    .filter((id): id is string => Boolean(id));
  const files = await prisma.fileUpload.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, storageKey: true },
  });
  const keyById = new Map(files.map((f) => [f.id, f.storageKey]));

  return students.map((s) => {
    const fileId = s.formSubmissions[0]?.fileId;
    return {
      id: s.id,
      displayName: s.displayName,
      studentId: s.studentId,
      firstName: s.spokesRecord?.firstName ?? null,
      lastName: s.spokesRecord?.lastName ?? null,
      storageKey: fileId ? (keyById.get(fileId) ?? null) : null,
    };
  });
}
