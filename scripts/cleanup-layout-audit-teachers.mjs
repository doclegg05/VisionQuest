/**
 * Removes leftover teacher accounts auto-created by an earlier UI/layout
 * audit run. Identified by email pattern `layout-audit-teacher-*@example.com`
 * (and role = "teacher"). They all share displayName "Maribel Thompson-
 * Henderson", which makes the admin "Assign instructors" UI render N
 * indistinguishable checkboxes. See audit findings 2026-04-29.
 *
 * Defaults to dry-run. Pass `--apply` to actually delete. Writes a JSON
 * backup of every affected row to artifacts/ before removing.
 *
 * Cascades aren't relied on — we explicitly delete linkage rows
 * (SpokesClassInstructor) before the parent. Audit-log rows are kept,
 * since they reference actorId by string and serve as a forensic trail.
 */

import { PrismaClient } from "@prisma/client";
import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const EMAIL_PATTERN = "layout-audit-teacher-";

async function main() {
  const candidates = await prisma.student.findMany({
    where: {
      role: "teacher",
      email: { startsWith: EMAIL_PATTERN, endsWith: "@example.com" },
    },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      email: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${candidates.length} layout-audit teacher account(s).`);
  if (candidates.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  for (const c of candidates) {
    console.log(`  - ${c.email}  (${c.id}, created ${c.createdAt.toISOString()})`);
  }

  // Inspect class linkages so the operator knows the blast radius before --apply.
  const linkages = await prisma.spokesClassInstructor.findMany({
    where: { instructorId: { in: candidates.map((c) => c.id) } },
    select: { classId: true, instructorId: true },
  });
  console.log(`Linked SpokesClassInstructor rows: ${linkages.length}`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to delete.");
    return;
  }

  // Backup first.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(`artifacts/layout-audit-teacher-cleanup-${stamp}.json`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(
    backupPath,
    JSON.stringify({ candidates, linkages }, null, 2),
    "utf8",
  );
  console.log(`Backup written: ${backupPath}`);

  // Delete linkages, then the accounts.
  const linkResult = await prisma.spokesClassInstructor.deleteMany({
    where: { instructorId: { in: candidates.map((c) => c.id) } },
  });
  console.log(`Deleted ${linkResult.count} SpokesClassInstructor row(s).`);

  const studentResult = await prisma.student.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  console.log(`Deleted ${studentResult.count} Student row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
