import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const OAUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600, // 10 minutes
  path: "/",
};

function resolveGoogleRedirectUri(req: NextRequest): string {
  const envUri = process.env.GOOGLE_REDIRECT_URI;
  if (envUri) return envUri;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GOOGLE_REDIRECT_URI must be set in production");
  }
  return new URL("/api/auth/google/callback", req.url).toString();
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// GET — redirect to Google OAuth consent screen
export async function GET(req: NextRequest) {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(new URL("/?error=oauth_not_configured", req.url));
  }

  const redirectUri = resolveGoogleRedirectUri(req);

  // CSRF state + PKCE verifier (S256)
  const state = crypto.randomBytes(32).toString("hex");
  const { verifier, challenge } = createPkcePair();
  const cookieStore = await cookies();
  cookieStore.set("oauth-state", state, OAUTH_COOKIE_OPTS);
  cookieStore.set("oauth-pkce", verifier, OAUTH_COOKIE_OPTS);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline", // Request refresh token for persistent sessions
    state,
    prompt: "select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
