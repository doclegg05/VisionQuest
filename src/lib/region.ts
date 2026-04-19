import "server-only";

import { prisma } from "@/lib/db";
import { type Session } from "@/lib/api-error";

export interface RegionSummary {
  id: string;
  name: string;
  code: string;
  status: string;
}

/**
 * Returns the regions a coordinator oversees. Admins (and other
 * super-scoped roles) see every active region. Anyone else gets only the
 * regions they're explicitly assigned to via RegionCoordinator.
 *
 * Non-coordinator, non-admin sessions get an empty list — the calling route
 * should 403 on that rather than relying on this helper to throw.
 */
export async function listRegionsForSession(session: Session): Promise<RegionSummary[]> {
  if (session.role === "admin") {
    return prisma.region.findMany({
      where: { status: "active" },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: "asc" },
    });
  }

  if (session.role !== "coordinator") {
    return [];
  }

  const assignments = await prisma.regionCoordinator.findMany({
    where: { coordinatorId: session.id, region: { status: "active" } },
    select: {
      region: { select: { id: true, name: true, code: true, status: true } },
    },
    orderBy: { region: { name: "asc" } },
  });

  return assignments.map((entry) => entry.region);
}

/**
 * Authorizes the current session to access the given region. Admins pass
 * automatically. Coordinators must have an entry in RegionCoordinator.
 * Throws nothing here — returns boolean so callers can craft their own 403.
 */
export async function coordinatorHasRegion(session: Session, regionId: string): Promise<boolean> {
  if (session.role === "admin") {
    const exists = await prisma.region.count({ where: { id: regionId } });
    return exists > 0;
  }
  if (session.role !== "coordinator") return false;
  const row = await prisma.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId: session.id } },
    select: { regionId: true },
  });
  return Boolean(row);
}

/**
 * Returns all classIds that belong to a region, constrained to non-archived
 * classes by default. Used as the core filter for all rollup queries so they
 * stay region-scoped.
 */
export async function classIdsInRegion(
  regionId: string,
  options: { includeArchived?: boolean } = {},
): Promise<string[]> {
  const rows = await prisma.spokesClass.findMany({
    where: {
      regionId,
      ...(options.includeArchived ? {} : { status: { not: "archived" } }),
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Counts classes in the system that have no regionId — used by the
 * coordinator dashboard callout so rollup exclusions are visible, not silent.
 */
export async function countUnregionedClasses(): Promise<number> {
  return prisma.spokesClass.count({
    where: { regionId: null, status: { not: "archived" } },
  });
}
