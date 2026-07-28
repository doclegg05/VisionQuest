import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prismaAdmin as prisma } from "@/lib/db";
import {
  setSessionCookie,
  normalizeEmail,
  signMfaSessionToken,
  setMfaSessionCookie,
} from "@/lib/auth";
import crypto from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { verifiedGoogleIdentity } from "@/lib/google-identity";
import { federatedLoginMfaDisposition } from "@/lib/auth-migration-policy";

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
  email_verified: boolean;
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
        email_verified: payload.email_verified === true,
        name: payload.name || "",
        picture: payload.picture,
      };
    } catch {
      return NextResponse.redirect(new URL("/?error=oauth_token_invalid", req.url));
    }
    const googleIdentity = verifiedGoogleIdentity({
      sub: userInfo.sub,
      email: userInfo.email,
      email_verified: userInfo.email_verified,
    });
    if (!googleIdentity) {
      return NextResponse.redirect(
        new URL("/?error=oauth_email_unverified", req.url),
      );
    }

    const normalizedEmail = normalizeEmail(googleIdentity.email);
    const providerId = googleIdentity.providerId;
    const providerSubject = googleIdentity.providerSubject;

    // Provider subject is the durable identity key. Email is used only for
    // the one-time migration/link step when no Google account binding exists.
    const existingBinding = await prisma.authAccount.findUnique({
      where: {
        providerId_accountId: {
          providerId,
          accountId: providerSubject,
        },
      },
      include: { user: true },
    });
    let student = existingBinding?.user ?? null;

    if (!student) {
      student = await prisma.student.findUnique({
        where: { email: normalizedEmail },
      });

      if (!student) {
        const baseId =
          userInfo.email
            .split("@")[0]
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "") || "student";

        let studentId = baseId;
        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            student = await prisma.student.create({
              data: {
                studentId,
                displayName: userInfo.name || userInfo.email.split("@")[0],
                email: normalizedEmail,
                emailVerified: true,
                profileImage: userInfo.picture,
                passwordHash: null,
                authProvider: "google",
                role: "student",
              },
            });
            break;
          } catch (err: unknown) {
            const isPrismaUniqueViolation =
              err &&
              typeof err === "object" &&
              "code" in err &&
              err.code === "P2002";
            if (!isPrismaUniqueViolation || attempt === maxAttempts - 1) {
              throw err;
            }

            // A concurrent callback may have created the email identity.
            const byEmail = await prisma.student.findUnique({
              where: { email: normalizedEmail },
            });
            if (byEmail) {
              student = byEmail;
              break;
            }
            studentId = `${baseId}${crypto.randomInt(1000, 9999)}`;
          }
        }
      }
      if (!student) {
        return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
      }

      if (!student.emailVerified) {
        student = await prisma.student.update({
          where: { id: student.id },
          data: {
            emailVerified: true,
            authProvider: student.authProvider ?? "google",
          },
        });
      }

      // Better Auth and the legacy callback share this account table. Its
      // accountId is Google's stable OIDC `sub`, never an email address.
      const binding = await prisma.authAccount.upsert({
        where: {
          providerId_accountId: {
            providerId,
            accountId: providerSubject,
          },
        },
        update: {},
        create: {
          id: crypto.randomUUID(),
          providerId,
          accountId: providerSubject,
          userId: student.id,
        },
        include: { user: true },
      });
      student = binding.user;
    }

    if (!student.isActive) {
      return NextResponse.redirect(new URL("/?error=account_deactivated", req.url));
    }

    const mfaDisposition = federatedLoginMfaDisposition(
      student.role,
      student.mfaEnabled,
    );
    if (mfaDisposition === "enrollment_required") {
      await logAuditEvent({
        actorId: student.id,
        actorRole: student.role,
        action: "auth.google_mfa_enrollment_required",
        targetType: "student",
        targetId: student.id,
        summary: `Google verified for ${student.studentId}, but staff MFA enrollment is required.`,
      });
      return NextResponse.redirect(
        new URL("/?error=mfa_enrollment_required", req.url),
      );
    }

    if (mfaDisposition === "challenge_required") {
      const mfaSessionToken = signMfaSessionToken(
        student.id,
        student.role,
        student.sessionVersion,
      );
      await setMfaSessionCookie(mfaSessionToken);

      await logAuditEvent({
        actorId: student.id,
        actorRole: student.role,
        action: "auth.google_mfa_required",
        targetType: "student",
        targetId: student.id,
        summary: `Google verified for ${student.studentId} — MFA challenge required.`,
      });

      const challengeUrl = new URL("/", req.url);
      challengeUrl.searchParams.set("mfa", "required");
      challengeUrl.searchParams.set("login", student.studentId);
      return NextResponse.redirect(challengeUrl);
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
