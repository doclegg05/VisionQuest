/**
 * Cleans up ProgramDocument rows whose `storageKey` points at a path that
 * doesn't exist in Supabase Storage. Four patterns of broken rows exist,
 * all produced by older/divergent seed runs; each has a correctly-shaped
 * sibling already in the table. See `docs-upload/_inventory.txt` and
 * `scripts/upload-to-supabase.mjs` for the canonical path shape.
 *
 *   1. storageKey startsWith "docs-upload/"
 *   2. storageKey startsWith "teachers/" but NOT "teachers/guides/"
 *   3. storageKey startsWith "students/" but NOT "students/resources/"
 *   4. storageKey startsWith "presentation/"  (singular — canonical is "presentations/")
 *   5. storageKey = "_inventory.txt"          (junk row from the inventory file itself)
 *
 * Writes a JSON backup of every deleted row before removing, and deletes
 * in batches of 100 so the DB isn't hammered.
 */

import { PrismaClient } from "@prisma/client";
import { writeFile } from "fs/promises";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

const WHERE = {
  OR: [
    { storageKey: { startsWith: "docs-upload/" } },
    {
      AND: [
        { storageKey: { startsWith: "teachers/" } },
        { NOT: { storageKey: { startsWith: "teachers/guides/" } } },
      ],
    },
    {
      AND: [
        { storageKey: { startsWith: "students/" } },
        { NOT: { storageKey: { startsWith: "students/resources/" } } },
      ],
    },
    { storageKey: { startsWith: "presentation/" } },
    { storageKey: "_inventory.txt" },
  ],
};

async function main() {
  const before = await prisma.programDocument.count();
  console.log(`Total ProgramDocument rows before: ${before}`);

  const broken = await prisma.programDocument.findMany({
    where: WHERE,
    select: {
      id: true,
      title: true,
      storageKey: true,
      audience: true,
      category: true,
    },
    orderBy: { storageKey: "asc" },
  });
  console.log(`Broken rows matching cleanup criteria: ${broken.length}`);

  if (broken.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Backup before deleting.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const backupPath = `broken-documents-backup-${stamp}.json`;
  await writeFile(backupPath, JSON.stringify(broken, null, 2), "utf-8");
  console.log(`Wrote backup → ${backupPath}`);

  // Break down by pattern for transparency.
  const counts = {
    docsUpload: broken.filter((r) => r.storageKey.startsWith("docs-upload/")).length,
    teachersNoGuides: broken.filter(
      (r) => r.storageKey.startsWith("teachers/") && !r.storageKey.startsWith("teachers/guides/"),
    ).length,
    studentsNoResources: broken.filter(
      (r) =>
        r.storageKey.startsWith("students/") && !r.storageKey.startsWith("students/resources/"),
    ).length,
    presentationSingular: broken.filter((r) => r.storageKey.startsWith("presentation/")).length,
    inventoryJunk: broken.filter((r) => r.storageKey === "_inventory.txt").length,
  };
  console.log(`Breakdown:`, counts);

  if (DRY_RUN) {
    console.log("\n--dry-run passed, not deleting. Sample of first 5 rows:");
    console.log(broken.slice(0, 5));
    await prisma.$disconnect();
    return;
  }

  const ids = broken.map((r) => r.id);
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const result = await prisma.programDocument.deleteMany({
      where: { id: { in: slice } },
    });
    deleted += result.count;
    console.log(
      `  batch ${Math.floor(i / BATCH) + 1}: deleted ${result.count} (${deleted}/${broken.length})`,
    );
  }

  const after = await prisma.programDocument.count();
  console.log(`Total ProgramDocument rows after:  ${after}`);
  console.log(`Net change: ${before - after} rows removed.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
