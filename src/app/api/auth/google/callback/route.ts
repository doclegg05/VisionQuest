import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prismaAdmin as prisma } from "@/lib/db";
import {
  setSessionCookie,
  setMfaSessionCookie,
  signMfaSessionToken,
  normalizeEmail,
} from "@/lib/auth";
import crypto from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function resolveGoogleRedirectUri(req: NextRequest): string {
  const envUri = process.env.GOOGLE_REDIRECT_URI;
  if (envUri) return envUri;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GOOGLE_REDIRECT_URI must be set in production");
  }
  return new URL("/api/auth/google/callback", req.url).toString();
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  refresh_token?: string; // Present when access_type=offline on first consent
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  /** Google's `email_verified` claim. An unverified address never reaches the database. */
  emailVerified: boolean;
  name: string;
  picture?: string;
}

type GoogleAccount = NonNullable<Awaited<ReturnType<typeof prisma.student.findUnique>>>;

/**
 * How a verified Google identity maps onto a Student row (review finding F9 /
 * SEC-01, 2026-09-01). `googleId` wins over email: an account bound to this
 * `sub` signs in regardless of its current address. A verified email may
 * claim only an account with no `googleId` yet, and the claim is written only
 * when a full session is issued (see `bindGoogleId`). An account bound to a
 * different Google identity is refused.
 */
type GoogleAccountResolution =
  | { kind: "by_sub"; student: GoogleAccount }
  | { kind: "by_email"; student: GoogleAccount }
  | { kind: "mismatch"; student: GoogleAccount }
  | { kind: "unknown" };

function isPrismaError(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === code);
}

async function resolveGoogleAccount(
  userInfo: GoogleUserInfo,
  normalizedEmail: string,
): Promise<GoogleAccountResolution> {
  const bySub = await prisma.student.findUnique({ where: { googleId: userInfo.sub } });
  if (bySub) return { kind: "by_sub", student: bySub };

  const byEmail = await prisma.student.findUnique({ where: { email: normalizedEmail } });
  if (!byEmail) return { kind: "unknown" };
  if (byEmail.googleId && byEmail.googleId !== userInfo.sub) {
    return { kind: "mismatch", student: byEmail };
  }
  return { kind: "by_email", student: byEmail };
}

/**
 * Claims an unbound row for this Google identity. Called only when a full
 * session is about to be issued: an MFA-enabled account gets the challenge
 * first and stays unbound, so a failed TOTP cannot leave an attacker's `sub`
 * on a staff account (no unlink exists yet; binding after TOTP inside the
 * challenge route is follow-up F67). Returns null when the claim lost a race.
 */
async function bindGoogleId(student: GoogleAccount, sub: string): Promise<GoogleAccount | null> {
  try {
    // The `googleId IS NULL` filter makes the claim atomic: a concurrent
    // sign-in that bound this row first leaves nothing to update (P2025).
    // It rides in AND because the unique-input type does not accept null.
    return await prisma.student.update({
      where: { id: student.id, AND: [{ googleId: null }] },
      data: { googleId: sub },
    });
  } catch (err: unknown) {
    if (isPrismaError(err, "P2025")) return null;
    throw err;
  }
}

/**
 * The one outcome for a verified Google identity that matches nothing here.
 *
 * `createStudentFromGoogle` used to run instead, minting a `role: "student"`
 * row for any address Google had verified — no invite, no domain allowlist, no
 * staff step (2026-09-06 hunt, follow-up 2). The day GOOGLE_CLIENT_ID is set in
 * production that is self-service enrolment into a FERPA-covered portal by
 * anyone on the internet. Who is enrolled is the program's decision; Google can
 * only vouch that the person owns the address.
 *
 * The redirect is the route's generic failure, not a distinct code, and neither
 * the audit event nor the log line carries the address or the `sub`: there is no
 * Student row to attribute this to, and an unsalted digest of an email would be
 * a dictionary away from the address itself (see the no-salt note in
 * src/lib/log-keys.ts, which holds for cuids and not for emails).
 */
async function refuseUnknownAccount(req: NextRequest) {
  logger.warn("Google sign-in refused: no VisionQuest account for this Google identity");
  await logAuditEvent({
    action: "auth.google_login_refused_unknown_account",
    targetType: "student",
    summary:
      "Google sign-in refused: the verified Google address matches no VisionQuest account. Accounts are created by staff, never by a sign-in.",
  });
  return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
}

/**
 * A deactivated account answers exactly like an unknown one. The password
 * route already does this (its 401 body is identical for unknown, wrong
 * password and deactivated); a distinct `account_deactivated` code here told
 * anyone who owned the address that a VisionQuest account had existed
 * (2026-09-07 audit, suggestion 5). The audit row keeps the distinction for
 * staff; the student's screen does not.
 */
async function refuseDeactivatedAccount(req: NextRequest, student: GoogleAccount) {
  logger.warn("Google sign-in refused: account deactivated", {
    student: studentLogKey(student.id),
  });
  await logAuditEvent({
    action: "auth.google_login_refused_deactivated",
    targetType: "student",
    targetId: student.id,
    summary: "Google sign-in refused: the account is deactivated.",
  });
  return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
}

async function refuseAccountMismatch(req: NextRequest, student: GoogleAccount) {
  logger.warn("Google sign-in refused: email is bound to a different Google account", {
    student: studentLogKey(student.id),
  });
  await logAuditEvent({
    action: "auth.google_login_refused_account_mismatch",
    targetType: "student",
    targetId: student.id,
    summary: `Google sign-in refused for ${student.studentId}: the email is bound to a different Google account.`,
  });
  return NextResponse.redirect(new URL("/?error=oauth_account_mismatch", req.url));
}

// GET — handle Google OAuth callback
export async function GET(req: NextRequest) {
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, req.url));

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return redirectTo("/?error=oauth_not_configured");
  }

  const redirectUri = resolveGoogleRedirectUri(req);

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return redirectTo("/?error=oauth_denied");
  }

  if (!code || !state) {
    return redirectTo("/?error=oauth_invalid");
  }

  // Verify state token
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth-state")?.value;
  cookieStore.delete("oauth-state");

  if (
    !storedState ||
    storedState.length !== state.length ||
    !crypto.timingSafeEqual(Buffer.from(storedState), Buffer.from(state))
  ) {
    return redirectTo("/?error=oauth_state_mismatch");
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return redirectTo("/?error=oauth_token_failed");
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json();

    // Log refresh token availability (upgrade path: store encrypted in Student model
    // for persistent Google API access without re-consent)
    if (tokenData.refresh_token) {
      logger.info("Google OAuth refresh token received", {
        hasRefreshToken: true,
      });
    }

    // Verify the id_token cryptographically against Google's public JWK set.
    // This validates the RS256 signature, audience, issuer, and expiry.
    let userInfo: GoogleUserInfo;
    try {
      const { OAuth2Client } = await import("google-auth-library");
      const client = new OAuth2Client(GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: tokenData.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new Error("id_token missing required claims");
      }
      userInfo = {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name || "",
        picture: payload.picture,
      };
    } catch {
      return redirectTo("/?error=oauth_token_invalid");
    }

    // Google vouches for ownership of a verified address only. Anything else
    // is refused before it can look up, link, or create an account.
    if (!userInfo.emailVerified) {
      logger.warn("Google sign-in refused: unverified email");
      await logAuditEvent({
        action: "auth.google_login_refused_unverified_email",
        targetType: "student",
        summary: "Google sign-in refused: Google has not verified the email address.",
      });
      return redirectTo("/?error=oauth_email_unverified");
    }

    const resolution = await resolveGoogleAccount(userInfo, normalizeEmail(userInfo.email));
    if (resolution.kind === "unknown") {
      return refuseUnknownAccount(req);
    }
    if (resolution.kind === "mismatch") {
      return refuseAccountMismatch(req, resolution.student);
    }

    if (!resolution.student.isActive) {
      return refuseDeactivatedAccount(req, resolution.student);
    }

    // Same second factor as the password route (login/route.ts): the
    // challenge cookie, scoped to /api/auth/mfa, and no session until
    // /api/auth/mfa/challenge verifies a TOTP or backup code. An
    // email-matched account stays unbound here; see bindGoogleId.
    if (resolution.student.mfaEnabled) {
      const { student } = resolution;
      await setMfaSessionCookie(signMfaSessionToken(student.id, student.role, student.sessionVersion));
      logger.info("Google sign-in requires MFA", { student: studentLogKey(student.id) });
      await logAuditEvent({
        actorId: student.id,
        actorRole: student.role,
        action: "auth.google_login_mfa_required",
        targetType: "student",
        targetId: student.id,
        summary: `Google sign-in verified for ${student.studentId} — MFA challenge required.`,
      });
      return redirectTo("/?mfa=1");
    }

    const student =
      resolution.kind === "by_email"
        ? await bindGoogleId(resolution.student, userInfo.sub)
        : resolution.student;
    if (!student) {
      return refuseAccountMismatch(req, resolution.student);
    }

    if (resolution.kind === "by_email") {
      await logAuditEvent({
        actorId: student.id,
        actorRole: student.role,
        action: "auth.google_link",
        targetType: "student",
        targetId: student.id,
        summary: `Google account linked to ${student.studentId} by verified email.`,
      });
    }

    // Set session cookie
    await setSessionCookie(student.id, student.role, student.sessionVersion);

    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "auth.google_login",
      targetType: "student",
      targetId: student.id,
      summary: `Google OAuth login for ${student.studentId}.`,
    });

    return redirectTo("/chat");
  } catch (err) {
    logger.error("OAuth callback error", { error: String(err) });
    return redirectTo("/?error=oauth_failed");
  }
}
