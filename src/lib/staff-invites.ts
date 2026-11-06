import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, StaffInvite } from "@prisma/client";
import { prismaAdmin } from "@/lib/db";
import type { Session } from "@/lib/api-error";
import { hashPassword, normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { tryLogAuditEvent } from "@/lib/audit";
import { canInviteRole, inviteNeedsRegion, type InvitableRole } from "@/lib/org-roles";
import { coordinatorHasRegion } from "@/lib/region";
import { registerStaffSchema } from "@/lib/schemas";

/**
 * Staff invites: how staff join the organization tree.
 *
 * Admins invite program coordinators, program coordinators invite regional
 * coordinators and instructors, and regional coordinators invite instructors
 * to their own regions (`canInviteRole`). Accepting an invite creates the
 * staff account and its region row in one transaction.
 *
 * The invite table is admin-only under RLS, so every query here goes through
 * `prismaAdmin`, the way `register-teacher` creates staff accounts. Authority
 * is checked in this module before any write.
 */

export const STAFF_INVITE_TTL_DAYS = 14;

export type StaffInviteError =
  | "invalid"
  | "expired"
  | "revoked"
  | "used"
  | "email_mismatch"
  | "not_allowed"
  | "region_not_allowed"
  | "region_required"
  | "inviter_no_longer_allowed";

export class StaffInviteRefused extends Error {
  constructor(readonly reason: StaffInviteError) {
    super(`Staff invite refused: ${reason}`);
    this.name = "StaffInviteRefused";
  }
}

const INVITABLE_ROLES = ["program_coordinator", "coordinator", "teacher"] as const;

/** Body shape for the create route. Exported for Task 8's `parseBody`. */
export const createStaffInviteSchema = z.object({
  email: z.string().trim().pipe(registerStaffSchema.shape.email),
  role: z.enum(INVITABLE_ROLES),
  regionId: z.string().cuid().optional(),
});

/**
 * Body shape for the accept route. Name, email and password reuse the staff
 * registration rules. Name and password are trimmed before the length check,
 * because `register-teacher` stores them trimmed and login trims the password.
 */
export const acceptStaffInviteSchema = z.object({
  token: z.string().min(1).max(128),
  email: z.string().trim().pipe(registerStaffSchema.shape.email),
  displayName: z.string().trim().pipe(registerStaffSchema.shape.displayName),
  password: z.string().trim().pipe(registerStaffSchema.shape.password),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AUDIT_TARGET = "staff_invite";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Region checks shared by create and revoke. */
async function assertMayInvite(
  actor: Session,
  role: InvitableRole,
  regionId: string | null,
): Promise<void> {
  if (!canInviteRole(actor.role, role)) throw new StaffInviteRefused("not_allowed");
  if (!inviteNeedsRegion(role)) return;
  if (!regionId) throw new StaffInviteRefused("region_required");
  if (!(await coordinatorHasRegion(actor, regionId))) {
    throw new StaffInviteRefused("region_not_allowed");
  }
}

function isInvitableRole(role: string): role is InvitableRole {
  return INVITABLE_ROLES.some((candidate) => candidate === role);
}

export async function createStaffInvite(
  inviter: Session,
  input: { email: string; role: InvitableRole; regionId?: string },
): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
  const parsed = createStaffInviteSchema.parse(input);
  // A program coordinator belongs to no region, so a supplied region is dropped.
  const regionId = inviteNeedsRegion(parsed.role) ? (parsed.regionId ?? null) : null;
  await assertMayInvite(inviter, parsed.role, regionId);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STAFF_INVITE_TTL_DAYS * MS_PER_DAY);
  const invite = await prismaAdmin.staffInvite.create({
    data: {
      email: normalizeEmail(parsed.email),
      role: parsed.role,
      regionId,
      invitedById: inviter.id,
      tokenHash: hashToken(token),
      expiresAt,
    },
    select: { id: true },
  });

  await tryLogAuditEvent({
    actorId: inviter.id,
    actorRole: inviter.role,
    action: "staff_invite.create",
    targetType: AUDIT_TARGET,
    targetId: invite.id,
    summary: `Staff invite created for role ${parsed.role}.`,
    metadata: { role: parsed.role, regionId },
  });

  return { inviteId: invite.id, token, expiresAt };
}

type InviteState = Pick<StaffInvite, "acceptedAt" | "revokedAt" | "expiresAt">;

/** Why an invite that could not be claimed is unusable. */
function unusableReason(invite: InviteState | null, now: Date): StaffInviteError {
  if (!invite) return "invalid";
  if (invite.acceptedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "invalid";
}

/**
 * The login name. Staff can also sign in by email, so this only has to be
 * unique: the email's local part, then `-2`, `-3` and so on. A race with
 * another accept for the same name fails on the unique index and rolls back.
 */
async function pickLoginName(tx: Prisma.TransactionClient, email: string): Promise<string> {
  const base = normalizeStudentId(email.split("@")[0] ?? "") || "staff";
  const taken = await tx.student.findMany({
    where: { studentId: { startsWith: base } },
    select: { studentId: true },
  });
  const names = new Set(taken.map((row) => row.studentId));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

async function placeInTree(tx: Prisma.TransactionClient, invite: StaffInvite, staffId: string): Promise<void> {
  if (!invite.regionId) return;
  // Regional only: a program coordinator invite carries no region (inviteNeedsRegion).
  if (invite.role === "coordinator") {
    await tx.regionCoordinator.create({ data: { regionId: invite.regionId, coordinatorId: staffId } });
  } else if (invite.role === "teacher") {
    await tx.regionInstructor.create({
      data: { regionId: invite.regionId, instructorId: staffId, assignedById: invite.invitedById },
    });
  }
}

/**
 * The inviter must still be allowed to send this invite when it is used: an
 * active account, a role that may invite this role, and for a regional
 * coordinator, still coordinating the invite's region. Runs inside the accept
 * transaction, so a refusal rolls the claim back.
 */
async function assertInviterStillAllowed(tx: Prisma.TransactionClient, invite: StaffInvite): Promise<void> {
  const inviter = await tx.student.findUnique({
    where: { id: invite.invitedById },
    select: { role: true, isActive: true },
  });
  const allowed =
    inviter !== null &&
    inviter.isActive &&
    isInvitableRole(invite.role) &&
    canInviteRole(inviter.role, invite.role);
  if (!allowed) throw new StaffInviteRefused("inviter_no_longer_allowed");
  // Regional only: whole-state inviters reach every region.
  if (inviter.role !== "coordinator") return;
  const stillCoordinates =
    invite.regionId !== null &&
    (await tx.regionCoordinator.findUnique({
      where: { regionId_coordinatorId: { regionId: invite.regionId, coordinatorId: invite.invitedById } },
      select: { regionId: true },
    })) !== null;
  if (!stillCoordinates) throw new StaffInviteRefused("inviter_no_longer_allowed");
}

interface AcceptedInvite {
  invite: StaffInvite;
  staffId: string;
}

async function claimAndCreate(
  input: z.infer<typeof acceptStaffInviteSchema>,
  passwordHash: string,
): Promise<AcceptedInvite> {
  const tokenHash = hashToken(input.token);
  const now = new Date();
  return prismaAdmin.$transaction(async (tx) => {
    // First statement: claim the invite. A concurrent accept waits on the row
    // lock, then finds acceptedAt set and claims nothing.
    const claim = await tx.staffInvite.updateMany({
      where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    const invite = await tx.staffInvite.findUnique({ where: { tokenHash } });
    if (claim.count !== 1 || !invite) throw new StaffInviteRefused(unusableReason(invite, now));

    // Throwing from here on rolls the claim back, so the invite stays usable.
    await assertInviterStillAllowed(tx, invite);
    if (normalizeEmail(input.email) !== invite.email) throw new StaffInviteRefused("email_mismatch");
    // Linking an existing account to an invite is Phase 2's job.
    const existing = await tx.student.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (existing) throw new StaffInviteRefused("email_mismatch");

    const account = await tx.student.create({
      data: {
        studentId: await pickLoginName(tx, invite.email),
        displayName: input.displayName,
        passwordHash,
        email: invite.email,
        role: invite.role,
      },
      select: { id: true },
    });
    await placeInTree(tx, invite, account.id);
    await tx.staffInvite.update({ where: { id: invite.id }, data: { acceptedById: account.id } });
    return { invite, staffId: account.id };
  });
}

export async function acceptStaffInvite(input: {
  token: string;
  email: string;
  displayName: string;
  password: string;
}): Promise<{ staffId: string }> {
  const parsed = acceptStaffInviteSchema.parse(input);
  const { hash } = hashPassword(parsed.password);
  const { invite, staffId } = await claimAndCreate(parsed, hash);

  await tryLogAuditEvent({
    actorId: staffId,
    actorRole: invite.role,
    action: "staff_invite.accept",
    targetType: AUDIT_TARGET,
    targetId: invite.id,
    summary: `Staff invite accepted for role ${invite.role}.`,
    metadata: { role: invite.role, regionId: invite.regionId, invitedById: invite.invitedById, staffId },
  });

  return { staffId };
}

/**
 * Revoke an invite that has not been accepted. Anyone who could send that
 * invite today may revoke it: same role rule, same region rule.
 */
export async function revokeStaffInvite(actor: Session, inviteId: string): Promise<void> {
  const invite = await prismaAdmin.staffInvite.findUnique({ where: { id: inviteId } });
  if (!invite || !isInvitableRole(invite.role)) throw new StaffInviteRefused("invalid");
  await assertMayInvite(actor, invite.role, invite.regionId);

  const now = new Date();
  const result = await prismaAdmin.staffInvite.updateMany({
    where: { id: inviteId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count !== 1) {
    const current = await prismaAdmin.staffInvite.findUnique({ where: { id: inviteId } });
    throw new StaffInviteRefused(current?.acceptedAt ? "used" : current?.revokedAt ? "revoked" : "invalid");
  }

  await tryLogAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "staff_invite.revoke",
    targetType: AUDIT_TARGET,
    targetId: invite.id,
    summary: `Staff invite revoked for role ${invite.role}.`,
    metadata: { role: invite.role, regionId: invite.regionId },
  });
}
