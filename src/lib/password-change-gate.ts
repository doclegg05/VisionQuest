/**
 * The forced password change: who it applies to, and what such a session may
 * still reach.
 *
 * Staff create student accounts and reset passwords in person, so until the
 * student picks a new one, a staff member knows the password. A session for
 * such an account carries a signed `mustChangePassword` claim
 * (src/lib/session-token.ts). src/proxy.ts sees every request, reads the
 * claim with no database lookup, and asks this file what the session may do.
 *
 * The rule is default-deny and matches whole paths:
 *   - A request passes only if "<METHOD> <path>" is on the list below, or it
 *     is a GET for one of the files in `public/`.
 *   - HEAD runs the GET handler, so it is held to the GET list.
 *   - A route added tomorrow is refused until someone lists it here.
 *
 * Apart from the change screen, the change route and the session route, every
 * entry is something a signed-out visitor can reach anyway, so a held session
 * gains nothing from it. password-change-gate.test.ts walks src/app and
 * `public/` and fails when an entry names something that is not there, when a
 * listed API route reads the session, or when the file list drifts.
 *
 * `src/proxy.ts` imports this file, so it must stay free of Prisma and of
 * anything else that is heavy or server-only. It imports nothing.
 */

/** The one screen a held session may use, and where every other page sends it. */
export const PASSWORD_CHANGE_PATH = "/change-password";

/** The `code` on the 403 an API route answers a held session with. */
export const PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED";

/** The words on that 403. A screen that shows an API error shows these. */
export const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  "Choose a new password first. Then you can use the rest of VisionQuest.";

export const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED: readonly string[] = [
  // The way out: the screen, the route it posts to, and reading or ending the session.
  `GET ${PASSWORD_CHANGE_PATH}`,
  "POST /api/settings/password",
  "GET /api/auth/session",
  "DELETE /api/auth/session",
  // Sign-in. None of these reads the session. The sign-in page is listed so a
  // session that has ended on the server still has somewhere to land: the
  // proxy cannot see that it ended, and would otherwise send it in a circle.
  "GET /",
  "POST /api/auth/login",
  "POST /api/auth/mfa/challenge",
  "GET /api/auth/google",
  "GET /api/auth/google/callback",
  // Recovery. A reset link opened in a browser that holds such a session must
  // still work; setting a password this way clears the requirement.
  "GET /forgot-password",
  "GET /reset-password",
  "POST /api/auth/forgot-password",
  "POST /api/auth/reset-password",
  "POST /api/auth/reset-password/questions",
  // Monitoring and browser reports. Neither returns anything about a person.
  "GET /api/health",
  "POST /api/csp-report",
];

/**
 * Every file in `public/`, as its URL path. Listed by name, never matched by
 * extension: a rule such as "ends in .png" would also pass a page or route
 * whose last segment a caller chose.
 */
export const PUBLIC_FILES: readonly string[] = [
  "/file.svg",
  "/globe.svg",
  "/images/sage-new-chat-symbol.png",
  "/media/sage-welcome-orientation-720p-v2.mp4",
  "/media/sage-welcome-orientation-captions-v1.vtt",
  "/media/sage-welcome-orientation-poster-v2.jpg",
  "/next.svg",
  "/robots.txt",
  "/spokes-logo.png",
  "/vercel.svg",
  "/window.svg",
  "/wvae-logo.png",
];

const ALLOWED = new Set<string>([
  ...ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED,
  ...PUBLIC_FILES.map((file) => `GET ${file}`),
]);

/** Whether a session that must change its password may make this request. */
export function isAllowedWhilePasswordChangeRequired(method: string, pathname: string): boolean {
  const upper = method.toUpperCase();
  return ALLOWED.has(`${upper === "HEAD" ? "GET" : upper} ${pathname}`);
}

/** What decides whether an account must change its password. A `Student` row has all four. */
export interface PasswordChangeAccount {
  mustChangePassword: boolean;
  role: string;
  /** Null when the account has no password: created by intake and not yet set, or Google only. */
  passwordHash: string | null;
  /** Null for a real account. */
  demoAccount: string | null;
}

/**
 * Whether a session for this account is held to the change screen. Every
 * place that issues a session asks this, and so does getSession(), so the
 * token's claim and the account row cannot drift apart unseen.
 *
 * True only for a student whose password somebody else set. An account with
 * no password has nothing a staff member could know, and the change screen
 * asks for the current password, so holding it there would trap the student.
 * Staff are never given a password by someone else. A demo account has no
 * password at all.
 */
export function passwordChangeRequired(account: PasswordChangeAccount): boolean {
  return (
    account.mustChangePassword === true &&
    account.role === "student" &&
    Boolean(account.passwordHash) &&
    !account.demoAccount
  );
}
