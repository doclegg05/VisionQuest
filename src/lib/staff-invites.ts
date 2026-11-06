import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, StaffInvite } from "@prisma/client";
import { prismaAdmin } from "@/lib/db";
import type { Session } from "@/lib/api-error";
import { hashPassword, normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { tryLogAuditEvent } from "@/lib/audit";
import { canInviteRole, inviteNeedsRegion, type InvitableRole } from "@/lib/org-roles";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
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
 *
 * Ruling R21: an invite whose email was sent needs a 6-digit code, emailed to
 * the same address, before it can be accepted. Only an admin may create a
 * link-only invite (email not set up, or the send failed); a link-only invite
 * accepts with no code.
 */

export const STAFF_INVITE_TTL_DAYS = 14;
export const STAFF_INVITE_CODE_TTL_MINUTES = 10;
/** Code tries allowed per invite, across codes. At the limit the invite is locked (Ruling R23). */
export const STAFF_INVITE_CODE_MAX_ATTEMPTS = 5;

export type StaffInviteError =
  | "invalid"
  | "expired"
  | "revoked"
  | "used"
  | "email_mismatch"
  | "not_allowed"
  | "region_not_allowed"
  | "region_required"
  | "inviter_no_longer_allowed"
  | "email_required"
  | "account_exists"
  | "code_required"
  | "code_invalid"
  | "code_expired"
  | "code_locked";

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
  /** The 6-digit email code. Required for an invite that was emailed (R21). */
  code: z.string().trim().regex(/^\d{6}$/).optional(),
});

export type AcceptStaffInviteInput = z.input<typeof acceptStaffInviteSchema>;
export type CreateStaffInviteInput = { email: string; role: InvitableRole; regionId?: string };

/** How the invite reached the person: emailed, the send threw, or email is not set up. */
export type InviteDelivery = "sent" | "failed" | "not_configured";

/** Sends the invite email for a token. Throws when the send fails. */
export type InviteDeliverer = (token: string, expiresAt: Date) => Promise<void>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AUDIT_TARGET = "staff_invite";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** SHA-256 of an accept code, bound to its invite so one hash cannot serve two invites. */
export function hashInviteCode(inviteId: string, code: string): string {
  return createHash("sha256").update(`${inviteId}:${code}`, "utf8").digest("hex");
}

function codeHashesMatch(stored: string, candidate: string): boolean {
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
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

/** Run the deliverer, if any. A send failure is logged by name only, never with the link. */
async function deliverInvite(
  deliver: InviteDeliverer | null,
  token: string,
  expiresAt: Date,
  inviter: Session,
): Promise<InviteDelivery> {
  if (!deliver) return "not_configured";
  try {
    await deliver(token, expiresAt);
    return "sent";
  } catch (error) {
    logger.error("staff_invite_email_failed", { actorId: inviter.id, error: errorForLog(error) });
    return "failed";
  }
}

/**
 * Create an invite. With a deliverer, the email goes out before the row is
 * written, so a send that throws leaves nothing behind for a non-admin
 * (Ruling R21: only an admin may create a link-only invite). The emailed link
 * starts working once the row exists, a moment after the send.
 */
export async function createStaffInvite(
  inviter: Session,
  input: CreateStaffInviteInput,
  deliver: InviteDeliverer | null = null,
): Promise<{ inviteId: string; token: string; expiresAt: Date; delivery: InviteDelivery }> {
  const parsed = createStaffInviteSchema.parse(input);
  // A program coordinator belongs to no region, so a supplied region is dropped.
  const regionId = inviteNeedsRegion(parsed.role) ? (parsed.regionId ?? null) : null;
  await assertMayInvite(inviter, parsed.role, regionId);
  const mayLinkOnly = inviter.role === "admin";
  if (!deliver && !mayLinkOnly) throw new StaffInviteRefused("email_required");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STAFF_INVITE_TTL_DAYS * MS_PER_DAY);
  const delivery = await deliverInvite(deliver, token, expiresAt, inviter);
  if (delivery !== "sent" && !mayLinkOnly) throw new StaffInviteRefused("email_required");

  const invite = await prismaAdmin.staffInvite.create({
    data: {
      email: normalizeEmail(parsed.email),
      role: parsed.role,
      regionId,
      invitedById: inviter.id,
      tokenHash: hashToken(token),
      expiresAt,
      deliveredByEmail: delivery === "sent",
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
    metadata: { role: parsed.role, regionId, deliveredByEmail: delivery === "sent" },
  });

  return { inviteId: invite.id, token, expiresAt, delivery };
}

type InviteState = Pick<StaffInvite, "acceptedAt" | "revokedAt" | "expiresAt">;

/** Why an invite cannot be accepted now, or null when it can. */
function unusableReason(invite: InviteState | null, now: Date): StaffInviteError | null {
  if (!invite) return "invalid";
  if (invite.acceptedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return null;
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

/**
 * A refusal from the code check. It is returned, not thrown, so the
 * transaction commits the wrong-attempt count before the caller refuses.
 */
type AcceptOutcome =
  | { kind: "accepted"; invite: StaffInvite; staffId: string }
  | { kind: "refused"; reason: StaffInviteError };

/**
 * Claim one of the invite's tries before comparing (Ruling R23). The claim is
 * a single conditional increment, so parallel guesses cannot all read a low
 * count and all compare: at most `STAFF_INVITE_CODE_MAX_ATTEMPTS` ever do.
 * Tries count per invite, across codes; a new code does not reset them. A
 * right code also uses a try, and the claim that follows uses up the code.
 */
async function claimAttempt(tx: Prisma.TransactionClient, invite: StaffInvite): Promise<StaffInviteError | null> {
  const claimed = await tx.staffInvite.updateMany({
    where: { id: invite.id, codeHash: invite.codeHash, codeAttempts: { lt: STAFF_INVITE_CODE_MAX_ATTEMPTS } },
    data: { codeAttempts: { increment: 1 } },
  });
  if (claimed.count === 1) return null;
  const current = await tx.staffInvite.findUnique({ where: { id: invite.id }, select: { codeAttempts: true } });
  // No try left: locked. Otherwise the code changed under us: a new one was sent.
  return (current?.codeAttempts ?? 0) >= STAFF_INVITE_CODE_MAX_ATTEMPTS ? "code_locked" : "code_expired";
}

/** Ruling R21: an emailed invite needs its current, unexpired code. */
async function checkCode(
  tx: Prisma.TransactionClient,
  invite: StaffInvite,
  code: string | undefined,
  now: Date,
): Promise<StaffInviteError | null> {
  if (!invite.deliveredByEmail) return null;
  if (!code) return "code_required";
  if (invite.codeAttempts >= STAFF_INVITE_CODE_MAX_ATTEMPTS) return "code_locked";
  const live = invite.codeHash !== null && invite.codeExpiresAt !== null && invite.codeExpiresAt.getTime() > now.getTime();
  if (!live || invite.codeHash === null) return "code_expired";
  const noTry = await claimAttempt(tx, invite);
  if (noTry) return noTry;
  // The try is spent and commits with the refusal, so it counts even when wrong.
  return codeHashesMatch(invite.codeHash, hashInviteCode(invite.id, code)) ? null : "code_invalid";
}

/**
 * Claim the invite. A concurrent accept waits on the row lock, then finds
 * acceptedAt set and claims nothing. For an emailed invite the claim also
 * requires the code that was checked, and uses it up.
 */
async function claimInvite(tx: Prisma.TransactionClient, invite: StaffInvite, now: Date): Promise<void> {
  const claim = await tx.staffInvite.updateMany({
    where: {
      id: invite.id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(invite.deliveredByEmail ? { codeHash: invite.codeHash } : {}),
    },
    data: { acceptedAt: now, codeHash: null, codeExpiresAt: null },
  });
  if (claim.count === 1) return;
  const current = await tx.staffInvite.findUnique({ where: { id: invite.id } });
  // Still usable, so the code changed under us: a new one was sent.
  throw new StaffInviteRefused(unusableReason(current, now) ?? "code_expired");
}

/** A region deleted since the invite was sent makes the invite unusable. */
async function assertRegionStillExists(tx: Prisma.TransactionClient, invite: StaffInvite): Promise<void> {
  if (!invite.regionId) return;
  const region = await tx.region.findUnique({ where: { id: invite.regionId }, select: { id: true } });
  if (!region) throw new StaffInviteRefused("invalid");
}

async function createAccount(
  tx: Prisma.TransactionClient,
  invite: StaffInvite,
  input: z.infer<typeof acceptStaffInviteSchema>,
  passwordHash: string,
): Promise<string> {
  await assertInviterStillAllowed(tx, invite);
  if (normalizeEmail(input.email) !== invite.email) throw new StaffInviteRefused("email_mismatch");
  // Linking an existing account to an invite is Phase 2's job. Stored emails
  // are not all normalized, so the match ignores casing.
  const existing = await tx.student.findFirst({
    where: { email: { equals: invite.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new StaffInviteRefused("account_exists");
  await assertRegionStillExists(tx, invite);

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
  return account.id;
}

function isForeignKeyFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}

/** A unique-index clash on `field`; Prisma names the clashing fields in `meta.target`. */
function isUniqueFailureOn(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return false;
  const target = "meta" in error && typeof error.meta === "object" && error.meta !== null && "target" in error.meta
    ? error.meta.target
    : null;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" && target.includes(field);
}

async function claimAndCreate(
  input: z.infer<typeof acceptStaffInviteSchema>,
  passwordHash: string,
): Promise<AcceptOutcome> {
  const tokenHash = hashToken(input.token);
  const now = new Date();
  try {
    return await prismaAdmin.$transaction(async (tx): Promise<AcceptOutcome> => {
      const invite = await tx.staffInvite.findUnique({ where: { tokenHash } });
      if (!invite) throw new StaffInviteRefused("invalid");
      const unusable = unusableReason(invite, now);
      if (unusable) throw new StaffInviteRefused(unusable);
      const codeRefusal = await checkCode(tx, invite, input.code, now);
      if (codeRefusal) return { kind: "refused", reason: codeRefusal };

      // Throwing from here on rolls the claim back, so the invite stays usable.
      await claimInvite(tx, invite, now);
      const staffId = await createAccount(tx, invite, input, passwordHash);
      return { kind: "accepted", invite, staffId };
    });
  } catch (error) {
    // The region went away between the check and the insert.
    if (isForeignKeyFailure(error)) throw new StaffInviteRefused("invalid");
    // Another invite to the same email was accepted between the email check
    // and the insert; the transaction rolled back, so this invite stays usable.
    if (isUniqueFailureOn(error, "email")) throw new StaffInviteRefused("account_exists");
    throw error;
  }
}

export async function acceptStaffInvite(input: AcceptStaffInviteInput): Promise<{ staffId: string }> {
  const parsed = acceptStaffInviteSchema.parse(input);
  const { hash } = hashPassword(parsed.password);
  const outcome = await claimAndCreate(parsed, hash);
  if (outcome.kind === "refused") throw new StaffInviteRefused(outcome.reason);
  const { invite, staffId } = outcome;

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
