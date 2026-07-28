import { isVerifiedGoogleIdentity } from "@/lib/auth-migration-policy";

export const GOOGLE_OIDC_ISSUER = "https://accounts.google.com";
export const GOOGLE_PROVIDER_ID = "google";

export interface GoogleIdentityClaims {
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
}

export interface VerifiedGoogleIdentity {
  issuer: typeof GOOGLE_OIDC_ISSUER;
  providerId: typeof GOOGLE_PROVIDER_ID;
  providerSubject: string;
  email: string;
}

export function verifiedGoogleIdentity(
  claims: GoogleIdentityClaims,
): VerifiedGoogleIdentity | null {
  const providerSubject = claims.sub;
  if (
    typeof providerSubject !== "string" ||
    providerSubject.length === 0 ||
    !isVerifiedGoogleIdentity(claims)
  ) {
    return null;
  }

  return {
    issuer: GOOGLE_OIDC_ISSUER,
    providerId: GOOGLE_PROVIDER_ID,
    providerSubject,
    email: claims.email,
  };
}

export function sameGoogleIdentity(
  left: GoogleIdentityClaims,
  right: GoogleIdentityClaims,
): boolean {
  const leftIdentity = verifiedGoogleIdentity(left);
  const rightIdentity = verifiedGoogleIdentity(right);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.issuer === rightIdentity.issuer &&
    leftIdentity.providerSubject === rightIdentity.providerSubject
  );
}
