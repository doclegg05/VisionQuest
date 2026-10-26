// Called only by the owned preview runner inside its isolated, marked snapshot.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth';
import { hashSecurityAnswers } from '../src/lib/security-question-auth';

async function main() {
  const runtime = process.argv[2];
  if (!runtime) throw new Error('Use npm run preview:local, not this seed directly');
  const marker = JSON.parse(readFileSync(`${runtime}/owner.json`, 'utf8'));
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== 'localhost' || url.searchParams.get('host') !== marker.socket || url.pathname !== '/vq_preview') throw new Error('Not the marked local preview database');
  const credentials = JSON.parse(readFileSync(`${runtime}/credentials.json`, 'utf8'));
  const prisma = new PrismaClient();
  try {
    const rows = [];
    for (const fixture of credentials.accounts) {
      rows.push(await prisma.student.create({ data: {
        studentId: fixture.login, displayName: fixture.name, email: `${fixture.login}@preview.invalid`, role: fixture.role,
        passwordHash: hashPassword(fixture.password).hash, isActive: true,
      } }));
    }
    const teacher = rows[2];
    const classroom = await prisma.spokesClass.create({ data: { code: 'synthetic-preview', name: 'Synthetic developer preview — no participants', createdById: teacher.id } });
    await prisma.spokesClassInstructor.create({ data: { classId: classroom.id, instructorId: teacher.id } });
    const recovery = hashSecurityAnswers({ birth_city: 'Synthetic City', elementary_school: 'Synthetic School', favorite_teacher: 'Synthetic Teacher' });
    for (const user of rows) {
      for (const answer of recovery) await prisma.securityQuestionAnswer.create({ data: { studentId: user.id, ...answer } });
      if (user.role !== 'student') continue;
      await prisma.studentClassEnrollment.create({ data: { studentId: user.id, classId: classroom.id } });
      await prisma.goal.create({ data: { studentId: user.id, level: 'bhag', content: 'Synthetic preview: explore a stable IT support career', status: 'confirmed', confirmedAt: new Date(), confirmedBy: teacher.id } });
      // One non-signature introductory step avoids a day-one redirect; no
      // certifications or verified participant outcomes are manufactured.
      await prisma.orientationProgress.create({ data: { studentId: user.id, itemId: 'seed-orient-0', completed: true, completedAt: new Date() } });
    }
    console.log('Created three synthetic preview accounts with recovery prerequisites; no certifications awarded.');
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Synthetic preview seed failed; inspect the private database state before retrying.'); process.exitCode = 1; });
