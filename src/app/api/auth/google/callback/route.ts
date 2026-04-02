import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { setSessionCookie, normalizeEmail } from "@/lib/auth";
import crypto from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function resolveGoogleRedirectUri(req: NextRequest) {
  return process.env.GOOGLE_REDIRECT_URI || new URL("/api/auth/google/callback", req.url).toString();
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

  // Verify state token
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth-state")?.value;
  cookieStore.delete("oauth-state");

  if (
    !storedState ||
    storedState.length !== state.length ||
    !crypto.timingSafeEqual(Buffer.from(storedState), Buffer.from(state))
  ) {
    return NextResponse.redirect(new URL("/?error=oauth_state_mismatch", req.url));
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
      return NextResponse.redirect(new URL("/?error=oauth_token_failed", req.url));
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json();

    // Log refresh token availability (upgrade path: store encrypted in Student model
    // for persistent Google API access without re-consent)
    if (tokenData.refresh_token) {
      logger.info("Google OAuth refresh token received", {
        hasRefreshToken: true,
      });
    }

    // Decode user info from the signed id_token (received directly from
    // Google's token endpoint over TLS with our client_secret, so the payload
    // is trustworthy without additional signature verification per Google's
    // server-side auth docs).
    let userInfo: GoogleUserInfo;
    try {
      const payload = tokenData.id_token.split(".")[1];
      if (!payload) throw new Error("Missing id_token payload");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (!decoded.sub || !decoded.email) throw new Error("id_token missing required claims");
      if (decoded.aud !== GOOGLE_CLIENT_ID) throw new Error("id_token aud mismatch");
      if (decoded.iss !== "accounts.google.com" && decoded.iss !== "https://accounts.google.com") throw new Error("id_token iss mismatch");
      userInfo = { sub: decoded.sub, email: decoded.email, name: decoded.name || "", picture: decoded.picture };
    } catch {
      return NextResponse.redirect(new URL("/?error=oauth_token_invalid", req.url));
    }
    const normalizedEmail = normalizeEmail(userInfo.email);

    // Find or create user
    let student = await prisma.student.findFirst({
      where: { email: normalizedEmail },
    });

    if (!student) {
      // Create new student from Google info
      // Use email prefix as studentId, ensure unique
      const baseId = userInfo.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");

      // Retry with random suffix to avoid TOCTOU race on studentId uniqueness
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

    if (!student.isActive) {
      return NextResponse.redirect(new URL("/?error=account_deactivated", req.url));
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

    return NextResponse.redirect(new URL("/chat", req.url));
  } catch (err) {
    logger.error("OAuth callback error", { error: String(err) });
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
