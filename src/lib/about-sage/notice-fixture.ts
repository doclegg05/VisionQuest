import { SAGE_NOTICE_VERSION, sageNoticeScope } from "./notice";

/**
 * For seeds and browser specs only. It marks a fixture student as having read
 * the current Sage notice, so the student layout does not send every seeded
 * student to /sage-notice.
 *
 * A real student acknowledges through POST /api/sage-notice, which checks the
 * version and writes the audit row. Nothing in the app calls this file.
 *
 * It takes the caller's database client because a seed opens its own
 * connection and must not load `@/lib/db`. ConsentRecord has no unique key on
 * (studentId, scope), so this looks before it writes and a second run adds
 * nothing.
 */

interface ConsentRowKey {
  studentId: string;
  scope: string;
  revokedAt: null;
}

interface ConsentRowData {
  studentId: string;
  scope: string;
  recordedBy: string;
}

/** The two ConsentRecord calls this helper makes. A PrismaClient satisfies it. */
export interface ConsentRecordWriter {
  consentRecord: {
    findFirst(args: { where: ConsentRowKey; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: { data: ConsentRowData; select: { id: true } }): Promise<{ id: string }>;
  };
}

export async function acknowledgeSageNoticeForFixture(
  client: ConsentRecordWriter,
  studentId: string,
): Promise<void> {
  const scope = sageNoticeScope(SAGE_NOTICE_VERSION);
  const onFile = await client.consentRecord.findFirst({
    where: { studentId, scope, revokedAt: null },
    select: { id: true },
  });
  if (onFile) return;
  await client.consentRecord.create({
    data: { studentId, scope, recordedBy: studentId },
    select: { id: true },
  });
}
