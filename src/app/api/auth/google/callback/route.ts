import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { setSessionCookie, hashPassword, normalizeEmail } from "@/lib/auth";
import crypto from "crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function resolveGoogleRedirectUri(req: NextRequest) {
  return process.env.GOOGLE_REDIRECT_URI || new URL("/api/auth/google/callback", req.url).toString();
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
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

    // Get user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(new URL("/?error=oauth_userinfo_failed", req.url));
    }

    const userInfo: GoogleUserInfo = await userRes.json();
    const normalizedEmail = normalizeEmail(userInfo.email);

    // Find or create user
    let student = await prisma.student.findFirst({
      where: { email: normalizedEmail },
    });

    if (!student) {
      // Create new student from Google info
      // Use email prefix as studentId, ensure unique
      const baseId = userInfo.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
      let studentId = baseId;
      let suffix = 1;
      while (await prisma.student.findUnique({ where: { studentId } })) {
        studentId = `${baseId}${suffix}`;
        suffix++;
      }

      // Generate a random password hash (user won't need it with OAuth)
      const { hash } = hashPassword(crypto.randomBytes(32).toString("hex"));

      student = await prisma.student.create({
        data: {
          studentId,
          displayName: userInfo.name || userInfo.email.split("@")[0],
          email: normalizedEmail,
          passwordHash: hash,
          role: "student", // OAuth users start as students
        },
      });
    }

    // Set session cookie
    await setSessionCookie(student.id, student.role, student.sessionVersion);

    return NextResponse.redirect(new URL("/chat", req.url));
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
