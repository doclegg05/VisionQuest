import { prismaAdmin } from "@/lib/db";
import type { Session } from "@/lib/api-error";
import { seesWholeState } from "@/lib/org-roles";
import { hashToken } from "@/lib/staff-invites";

const LIST_LIMIT = 100;

export type StaffInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface StaffInviteRow {
  id: string;
  email: string;
  role: string;
  regionId: string | null;
  regionName: string | null;
  status: StaffInviteStatus;
  expiresAt: string;
  createdAt: string;
}

function statusOf(
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): StaffInviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

/**
 * Invites the caller may see: all of them for an admin or program
 * coordinator, only the ones they sent for a regional coordinator.
 */
export async function listStaffInvites(actor: Session): Promise<StaffInviteRow[]> {
  const invites = await prismaAdmin.staffInvite.findMany({
    where: seesWholeState(actor.role) ? {} : { invitedById: actor.id },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  const regionIds = [...new Set(invites.flatMap((i) => (i.regionId ? [i.regionId] : [])))];
  const regions = regionIds.length
    ? await prismaAdmin.region.findMany({ where: { id: { in: regionIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(regions.map((r) => [r.id, r.name]));
  const now = new Date();
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    regionId: invite.regionId,
    regionName: invite.regionId ? (names.get(invite.regionId) ?? null) : null,
    status: statusOf(invite, now),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }));
}

export interface StaffInvitePreview {
  email: string;
  role: string;
  regionName: string | null;
}

/** What the accept page shows. Null for any invite that cannot be accepted now. */
export async function previewStaffInvite(token: string): Promise<StaffInvitePreview | null> {
  if (!token || token.length > 128) return null;
  const invite = await prismaAdmin.staffInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || statusOf(invite, new Date()) !== "pending") return null;
  const region = invite.regionId
    ? await prismaAdmin.region.findUnique({ where: { id: invite.regionId }, select: { name: true } })
    : null;
  return { email: invite.email, role: invite.role, regionName: region?.name ?? null };
}

export async function regionNameFor(regionId: string | undefined): Promise<string | null> {
  if (!regionId) return null;
  const region = await prismaAdmin.region.findUnique({ where: { id: regionId }, select: { name: true } });
  return region?.name ?? null;
}
