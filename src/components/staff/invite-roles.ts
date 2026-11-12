/**
 * The roles an admin can invite, least access first. The invite form opens on
 * the first one, so the default must never be the role that sees every
 * region: a program coordinator needs no region, and an admin who only typed
 * an email would have sent that invite.
 */
export const ADMIN_INVITE_ROLES = ["teacher", "coordinator", "program_coordinator"] as const;
