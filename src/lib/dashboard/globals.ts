/**
 * Rows every student's dashboard reads the same: the orientation checklist's
 * size and the Ready-to-Work requirement templates. Their RLS read policies
 * are `FOR SELECT TO vq_app USING (true)` (prisma/migrations/00000000000000_baseline,
 * orientation_item_read and cert_template_read), so every role sees the same
 * rows and no key needs a role or a student.
 */
import type { CertTemplate } from "@prisma/client";
import { prisma } from "@/lib/db";
import { READY_TO_WORK_TEMPLATES } from "./readers";

export interface DashboardGlobals {
  readonly orientationTotalCount: number;
  readonly readyToWorkTemplates: readonly CertTemplate[];
}

export async function readDashboardGlobals(): Promise<DashboardGlobals> {
  const [orientationTotalCount, readyToWorkTemplates] = await Promise.all([
    prisma.orientationItem.count(),
    prisma.certTemplate.findMany(READY_TO_WORK_TEMPLATES),
  ]);
  return { orientationTotalCount, readyToWorkTemplates };
}
