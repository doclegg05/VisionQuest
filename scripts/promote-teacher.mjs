import fs from "node:fs";

const shellProvidedKeys = new Set(Object.keys(process.env));

for (const filename of [".env", ".env.local"]) {
  if (!fs.existsSync(filename)) continue;

  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || shellProvidedKeys.has(key)) continue;

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const identifier = (process.argv[2] || "").trim().toLowerCase();

  try {
    if (!identifier) {
      throw new Error("Usage: npm run users:promote-teacher -- <student-id-or-email>");
    }

    const student = await prisma.student.findFirst({
      where: {
        OR: [
          { studentId: identifier },
          { email: identifier },
        ],
      },
      select: {
        id: true,
        studentId: true,
        email: true,
        role: true,
      },
    });

    if (!student) {
      throw new Error(`No student account found for "${identifier}".`);
    }

    if (student.role === "teacher") {
      console.log(`${student.studentId} is already a teacher.`);
      return;
    }

    await prisma.$transaction([
      prisma.student.update({
        where: { id: student.id },
        data: {
          role: "teacher",
          sessionVersion: { increment: 1 },
        },
      }),
      prisma.auditLog.create({
        data: {
          actorRole: "system",
          action: "system.teacher.promote",
          targetType: "student",
          targetId: student.id,
          summary: `Promoted ${student.studentId} to teacher.`,
          metadata: JSON.stringify({
            studentId: student.studentId,
            email: student.email,
          }),
        },
      }),
    ]);

    console.log(`Promoted ${student.studentId} to teacher.`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
