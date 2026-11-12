/**
 * Rows every student's dashboard reads the same: the orientation checklist's
 * size and the Ready-to-Work requirement templates. Their RLS read policies
 * are `FOR SELECT TO vq_app USING (true)` (prisma/migrations/00000000000000_baseline,
 * orientation_item_read and cert_template_read), so every role sees the same
 * rows and no key needs a role or a student. Both are kept per process; the
 * write-through clears every student's chat context, these keys included, on
 * any OrientationItem or CertTemplate write (GLOBAL_MODEL_LIST in
 * src/lib/chat-context-write-through.ts).
 */
import type { CertTemplate } from "@prisma/client";
import { prisma } from "@/lib/db";
import { READY_TO_WORK_TEMPLATES } from "./readers";
import { cachedWhen, globalCacheKey } from "./student-cache";

export interface DashboardGlobals {
  readonly orientationTotalCount: number;
  readonly readyToWorkTemplates: readonly CertTemplate[];
}

/** Ten minutes. A write to either table clears both; see ./student-cache.ts. */
export const GLOBALS_TTL_SECONDS = 600;

const readOrientationTotal = () => prisma.orientationItem.count();
const readReadyToWorkTemplates = () => prisma.certTemplate.findMany(READY_TO_WORK_TEMPLATES);

/** Kept only when non-zero: an empty answer is what a read without RLS context sees. */
export function orientationTotal(): Promise<number> {
  return cachedWhen(globalCacheKey("orientation-item-count"), GLOBALS_TTL_SECONDS, readOrientationTotal, (n) => n > 0);
}

/** Kept only when non-empty, for the same reason. The overview alone reads it. */
export function readyToWorkTemplates(): Promise<readonly CertTemplate[]> {
  return cachedWhen(globalCacheKey("ready-to-work-templates"), GLOBALS_TTL_SECONDS, readReadyToWorkTemplates, (rows) => rows.length > 0);
}

export async function readDashboardGlobals(): Promise<DashboardGlobals> {
  const [orientationTotalCount, templates] = await Promise.all([orientationTotal(), readyToWorkTemplates()]);
  return { orientationTotalCount, readyToWorkTemplates: templates };
}
