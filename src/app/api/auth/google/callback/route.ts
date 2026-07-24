import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prismaAdmin as prisma } from "@/lib/db";
import { setSessionCookie, normalizeEmail } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import crypto from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";

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

function parseAllowedDomains(): string[] {
  return (process.env.GOOGLE_ALLOWED_DOMAINS || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailDomainAllowed(email: string): boolean {
  const allowed = parseAllowedDomains();
  if (allowed.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowed.includes(domain));
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
  emailVerified: boolean;
  name: string;
  picture?: string;
}

// GET — handle Google OAuth callback
export async function GET(req: NextRequest) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/?error=oauth_not_configured", req.url));
  }

  const redirectUri = resolveGoogleRedirectUri(req);

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/?error=oauth_denied", req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?error=oauth_invalid", req.url));
  }

  // Verify state token + read PKCE verifier
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth-state")?.value;
  const pkceVerifier = cookieStore.get("oauth-pkce")?.value;
  cookieStore.delete("oauth-state");
  cookieStore.delete("oauth-pkce");

  if (
    !storedState ||
    storedState.length !== state.length ||
    !crypto.timingSafeEqual(Buffer.from(storedState), Buffer.from(state))
  ) {
    return NextResponse.redirect(new URL("/?error=oauth_state_mismatch", req.url));
  }

  try {
    const tokenBody = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    // Production authorize always sets oauth-pkce; include verifier when present.
    if (pkceVerifier) {
      tokenBody.set("code_verifier", pkceVerifier);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL("/?error=oauth_token_failed", req.url));
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json();

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
      return NextResponse.redirect(new URL("/?error=oauth_token_invalid", req.url));
    }

    if (!userInfo.emailVerified) {
      return NextResponse.redirect(new URL("/?error=oauth_email_unverified", req.url));
    }

    const normalizedEmail = normalizeEmail(userInfo.email);

    if (!isEmailDomainAllowed(normalizedEmail)) {
      return NextResponse.redirect(new URL("/?error=oauth_domain_denied", req.url));
    }

    const encryptedRefresh =
      typeof tokenData.refresh_token === "string" && tokenData.refresh_token.length > 0
        ? encrypt(tokenData.refresh_token)
        : null;

    // Prefer stable Google subject binding over email matching
    let student = await prisma.student.findFirst({
      where: { googleSub: userInfo.sub },
    });
    // Defense: only accept a hit when the persisted subject matches the token.
    if (student && student.googleSub !== userInfo.sub) {
      student = null;
    }

    if (!student) {
      const byEmail = await prisma.student.findFirst({
        where: { email: normalizedEmail },
      });

      if (byEmail) {
        // Legacy Google-only row missing googleSub: bind and continue.
        // Password (or any other) accounts require an explicit link flow — never auto-login.
        const isLegacyGoogleOnly =
          byEmail.authProvider === "google" &&
          !byEmail.passwordHash &&
          !byEmail.googleSub;

        if (!isLegacyGoogleOnly) {
          return NextResponse.redirect(new URL("/?error=oauth_link_required", req.url));
        }

        student = await prisma.student.update({
          where: { id: byEmail.id },
          data: {
            googleSub: userInfo.sub,
            ...(encryptedRefresh
              ? { googleRefreshTokenEncrypted: encryptedRefresh }
              : {}),
          },
        });
      } else {
        // Create new student from Google info
        const baseId = userInfo.email
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "");

        let studentId = baseId;
        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            student = await prisma.student.create({
              data: {
                studentId,
                displayName: userInfo.name || userInfo.email.split("@")[0],
                email: normalizedEmail,
                passwordHash: null,
                authProvider: "google",
                googleSub: userInfo.sub,
                ...(encryptedRefresh
                  ? { googleRefreshTokenEncrypted: encryptedRefresh }
                  : {}),
                role: "student",
              },
            });
            break;
          } catch (err: unknown) {
            const isPrismaUniqueViolation =
              err && typeof err === "object" && "code" in err && err.code === "P2002";
            if (!isPrismaUniqueViolation || attempt === maxAttempts - 1) throw err;
            studentId = `${baseId}${crypto.randomInt(1000, 9999)}`;
          }
        }
        if (!student) {
          return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
        }
      }
    } else if (encryptedRefresh) {
      await prisma.student.update({
        where: { id: student.id },
        data: { googleRefreshTokenEncrypted: encryptedRefresh },
      });
    }

    if (!student.isActive) {
      return NextResponse.redirect(new URL("/?error=account_deactivated", req.url));
    }

    await setSessionCookie(student.id, student.role, student.sessionVersion);

    await logAuditEvent({
      actorId: student.id,
      actorRole: student.role,
      action: "auth.google_login",
      targetType: "student",
      targetId: student.id,
      summary: `Google OAuth login for ${student.studentId}.`,
    });

    return NextResponse.redirect(new URL("/chat", req.url));
  } catch (err) {
    logger.error("OAuth callback error", { error: String(err) });
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
