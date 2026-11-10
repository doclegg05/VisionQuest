/**
 * The student layout's two one-time gates, read so that only a satisfied
 * answer is ever kept (F2 step 3).
 *
 * Both are monotonic in practice: recovery answers are only ever replaced,
 * delete and create in one transaction (src/app/api/settings/security-questions/route.ts),
 * and the Sage notice acknowledgement is outside the self-service consent
 * scopes, so nothing revokes it. A kept "satisfied" therefore cannot let a
 * student past a gate they have not passed, and an unsatisfied student is read
 * on every request, so no kept value can hold one at a gate after they pass it.
 *
 * Keys hold the student's id (and the notice version) and are filled only
 * from the student's own session; see ./student-cache.ts. The layout keeps
 * deciding with needsSageNotice and needsRecoverySetup, in the same order.
 */
import { hasAcknowledgedSageNotice } from "@/lib/consent";
import { prisma } from "@/lib/db";
import { hasConfiguredSecurityQuestionSet } from "@/lib/security-questions";
import { cachedWhen, studentCacheKey, type CacheSession } from "./student-cache";

/** Ten minutes. A satisfied gate does not become unsatisfied; see above. */
export const GATE_TTL_SECONDS = 600;

async function readQuestionKeys(studentId: string): Promise<readonly string[]> {
  const rows = await prisma.securityQuestionAnswer.findMany({ where: { studentId }, select: { questionKey: true } });
  return rows.map((row) => row.questionKey);
}

/** The student's recovery question keys; kept only once they form a full set. */
export function readRecoveryQuestionKeys(session: CacheSession): Promise<readonly string[]> {
  return cachedWhen(
    studentCacheKey(session, "gate:recovery-questions"),
    GATE_TTL_SECONDS,
    () => readQuestionKeys(session.id),
    (keys) => hasConfiguredSecurityQuestionSet(keys),
  );
}

/** Whether the student acknowledged this notice version; kept only once true. */
export function readSageNoticeAcknowledged(session: CacheSession, version: string): Promise<boolean> {
  return cachedWhen(
    studentCacheKey(session, `gate:sage-notice:${version}`),
    GATE_TTL_SECONDS,
    () => hasAcknowledgedSageNotice(session.id, version),
    (acknowledged) => acknowledged,
  );
}
