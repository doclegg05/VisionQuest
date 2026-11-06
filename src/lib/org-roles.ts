export const PROGRAM_COORDINATOR = "program_coordinator";

export type InvitableRole = "program_coordinator" | "coordinator" | "teacher";

/** True for the regional coordinator and the program-wide coordinator. */
export function isCoordinatorRole(role: string): boolean {
  return role === "coordinator" || role === PROGRAM_COORDINATOR;
}

/**
 * Roles that read every region and class in the state, not just assigned ones.
 * The one source for that list: `seesWholeState` and `STAFF_CAN_MANAGE_ANY`
 * (src/lib/classroom.ts) both read it.
 */
export const WHOLE_STATE_ROLES: readonly string[] = ["admin", PROGRAM_COORDINATOR];

export function seesWholeState(role: string): boolean {
  return WHOLE_STATE_ROLES.includes(role);
}

/** Who may invite whom: admin > program coordinator > regional coordinator. */
export function canInviteRole(inviterRole: string, invitedRole: InvitableRole): boolean {
  if (inviterRole === "admin") return true;
  if (inviterRole === PROGRAM_COORDINATOR) return invitedRole !== PROGRAM_COORDINATOR;
  if (inviterRole === "coordinator") return invitedRole === "teacher";
  return false;
}

/** Regional coordinators and instructors belong to a region; program coordinators do not. */
export function inviteNeedsRegion(role: InvitableRole): boolean {
  return role === "coordinator" || role === "teacher";
}
