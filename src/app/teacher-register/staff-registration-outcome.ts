import { z } from "zod";

export type StaffRole = "teacher" | "admin";

export type StaffRegistrationOutcome =
  | { kind: "redirect"; href: "/admin" | "/teacher" }
  | { kind: "promoted"; message: string };

/**
 * Shown when a promotion response carries no message. Kept at a 6th-grade
 * reading level like the route's own copy (src/lib/sage/readability.ts).
 */
export const FALLBACK_PROMOTION_MESSAGE =
  "This account is now an admin. Sign in with its current password to continue.";

const promotionResponseSchema = z.object({
  promoted: z.literal(true),
  message: z.string().optional(),
});

/**
 * What the staff registration page does after a 2xx from
 * /api/auth/register-teacher. A promotion issues no session (review F11 /
 * SEC-05), so redirecting would land the caller on the login form with no
 * explanation; the page shows the response message instead.
 */
export function resolveStaffRegistrationOutcome(data: unknown, role: StaffRole): StaffRegistrationOutcome {
  const promotion = promotionResponseSchema.safeParse(data);
  if (promotion.success) {
    const message = promotion.data.message?.trim();
    return { kind: "promoted", message: message || FALLBACK_PROMOTION_MESSAGE };
  }
  return { kind: "redirect", href: role === "admin" ? "/admin" : "/teacher" };
}
