import { prisma } from "@/lib/db";
import { selectOpenOrientationItems, type OpenOrientationItem } from "./attachment-context";

/**
 * The student's orientation checklist items a signed form can still be filed
 * against, for the attachment block of a chat turn. Two small reads on turns
 * that carry a file; nothing on any other turn.
 */
export async function loadOpenOrientationItems(studentId: string): Promise<OpenOrientationItem[]> {
  const [items, progress] = await Promise.all([
    prisma.orientationItem.findMany({
      select: { id: true, label: true, required: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.orientationProgress.findMany({
      where: { studentId },
      select: { itemId: true, completed: true, verificationStatus: true },
    }),
  ]);
  return selectOpenOrientationItems(items, progress);
}
