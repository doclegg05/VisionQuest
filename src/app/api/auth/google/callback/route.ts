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
 * `sub` signs in regardless of its current address. A verified email links
 * only an account with no `googleId` yet, and the link is refused when the
 * account is already bound to a different Google identity.
 */
type GoogleAccountResolution =
  | { kind: "found"; student: GoogleAccount }
  | { kind: "linked"; student: GoogleAccount }
  | { kind: "created"; student: GoogleAccount }
  | { kind: "mismatch"; student: GoogleAccount }
  | { kind: "create_failed" };

function isPrismaError(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === code);
}

async function createStudentFromGoogle(
  userInfo: GoogleUserInfo,
  normalizedEmail: string,
): Promise<GoogleAccount | null> {
  // Use email prefix as studentId, ensure unique
  const baseId = userInfo.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");

  // Retry with random suffix to avoid TOCTOU race on studentId uniqueness
  let studentId = baseId;
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.student.create({
        data: {
          studentId,
          displayName: userInfo.name || userInfo.email.split("@")[0],
          email: normalizedEmail,
          passwordHash: null,
          authProvider: "google",
          googleId: userInfo.sub,
          role: "student",
        },
      });
    } catch (err: unknown) {
      if (!isPrismaError(err, "P2002") || attempt === maxAttempts - 1) throw err;
      studentId = `${baseId}${crypto.randomInt(1000, 9999)}`;
    }
  }
  return null;
}

async function resolveGoogleAccount(
  userInfo: GoogleUserInfo,
  normalizedEmail: string,
): Promise<GoogleAccountResolution> {
  const bySub = await prisma.student.findUnique({ where: { googleId: userInfo.sub } });
  if (bySub) return { kind: "found", student: bySub };

  const byEmail = await prisma.student.findUnique({ where: { email: normalizedEmail } });
  if (!byEmail) {
    const created = await createStudentFromGoogle(userInfo, normalizedEmail);
    return created ? { kind: "created", student: created } : { kind: "create_failed" };
  }
  if (byEmail.googleId && byEmail.googleId !== userInfo.sub) {
    return { kind: "mismatch", student: byEmail };
  }
  // Refused downstream; a deactivated account is not linked.
  if (!byEmail.isActive) return { kind: "found", student: byEmail };

  try {
    // The `googleId IS NULL` filter makes the claim atomic: a concurrent
    // sign-in that bound this row first leaves nothing to update (P2025).
    // It rides in AND because the unique-input type does not accept null.
    const linked = await prisma.student.update({
      where: { id: byEmail.id, AND: [{ googleId: null }] },
      data: { googleId: userInfo.sub },
    });
    return { kind: "linked", student: linked };
  } catch (err: unknown) {
    if (isPrismaError(err, "P2025")) return { kind: "mismatch", student: byEmail };
    throw err;
  }
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
    if (resolution.kind === "create_failed") {
      return redirectTo("/?error=oauth_failed");
    }
    const { student } = resolution;

    if (resolution.kind === "mismatch") {
      logger.warn("Google sign-in refused: email is bound to a different Google account", {
        student: studentLogKey(student.id),
      });
      await logAuditEvent({
        action: "auth.google_login_refused_account_mismatch",
        targetType: "student",
        targetId: student.id,
        summary: `Google sign-in refused for ${student.studentId}: the email is bound to a different Google account.`,
      });
      return redirectTo("/?error=oauth_account_mismatch");
    }

    if (!student.isActive) {
      return redirectTo("/?error=account_deactivated");
    }

    if (resolution.kind === "linked") {
      await logAuditEvent({
        actorId: student.id,
        actorRole: student.role,
        action: "auth.google_link",
        targetType: "student",
        targetId: student.id,
        summary: `Google account linked to ${student.studentId} by verified email.`,
      });
    }

    // Same second factor as the password route (login/route.ts): the
    // challenge cookie, scoped to /api/auth/mfa, and no session until
    // /api/auth/mfa/challenge verifies a TOTP or backup code.
    if (student.mfaEnabled) {
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
