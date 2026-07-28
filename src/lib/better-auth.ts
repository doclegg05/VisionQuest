import crypto from "node:crypto";
import { parse as parseCookie } from "cookie";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { setSessionCookie } from "better-auth/cookies";
import { prismaAdmin } from "@/lib/db";
import {
  isBetterAuthGoogleEnabled,
  isVerifiedGoogleIdentity,
  requiresVerifiedBetterAuthSession,
  requiresStaffMfaEnrollment,
  requiresStaffMfaHandoff,
} from "@/lib/auth-migration-policy";
import { verifyToken } from "@/lib/session-token";

const LEGACY_SESSION_COOKIE = "vq-session";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const ONE_DAY_SECONDS = 60 * 60 * 24;
const DEVELOPMENT_SECRET =
  "visionquest-development-only-better-auth-secret-v1";

function getBetterAuthSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET must be configured with at least 32 characters",
    );
  }

  return DEVELOPMENT_SECRET;
}

function getTrustedOrigins(): string[] {
  const candidates = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.RENDER_EXTERNAL_URL,
  ];
  const origins = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Invalid optional origins are ignored here. Better Auth still enforces
      // the request origin against its own base URL.
    }
  }

  return [...origins];
}

function getPasskeyRelyingParty(): {
  rpID?: string;
  origin?: string;
} {
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured) return {};

  try {
    const url = new URL(configured);
    return { rpID: url.hostname, origin: url.origin };
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_URL must be a valid absolute URL");
    }
    return {};
  }
}

function createStudentId(): string {
  return `oauth-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function legacySessionBridge(): BetterAuthPlugin {
  return {
    id: "visionquest-legacy-session-bridge",
    endpoints: {
      bridgeLegacySession: createAuthEndpoint(
        "/visionquest/bridge-legacy-session",
        { method: "POST" },
        async (ctx) => {
          const cookieHeader =
            ctx.headers?.get("cookie") ??
            ctx.request?.headers.get("cookie") ??
            "";
          const legacyToken = parseCookie(cookieHeader)[LEGACY_SESSION_COOKIE];
          const claims = legacyToken ? verifyToken(legacyToken) : null;
          if (!claims) {
            throw APIError.from("UNAUTHORIZED", {
              code: "LEGACY_SESSION_REQUIRED",
              message: "Sign in before adding a passkey.",
            });
          }

          const student = await prismaAdmin.student.findUnique({
            where: { id: claims.sub },
            select: {
              id: true,
              studentId: true,
              displayName: true,
              email: true,
              emailVerified: true,
              profileImage: true,
              role: true,
              isActive: true,
              mfaEnabled: true,
              sessionVersion: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          if (
            !student ||
            !student.isActive ||
            student.sessionVersion !== claims.sv
          ) {
            throw APIError.from("UNAUTHORIZED", {
              code: "LEGACY_SESSION_INVALID",
              message: "Your session is no longer valid. Sign in again.",
            });
          }
          if (!student.email) {
            throw APIError.from("BAD_REQUEST", {
              code: "EMAIL_REQUIRED_FOR_PASSKEY",
              message: "Add an email address before registering a passkey.",
            });
          }
          if (requiresStaffMfaEnrollment(student.role, student.mfaEnabled)) {
            throw APIError.from("FORBIDDEN", {
              code: "STAFF_MFA_ENROLLMENT_REQUIRED",
              message:
                "Set up multi-factor authentication before adding a passkey.",
            });
          }
          if (
            requiresStaffMfaHandoff(student.role, student.mfaEnabled) &&
            claims.mfa !== true
          ) {
            throw APIError.from("UNAUTHORIZED", {
              code: "STAFF_MFA_REAUTH_REQUIRED",
              message:
                "Sign in again and complete multi-factor authentication before adding a passkey.",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            student.id,
            false,
            {
              sessionVersion: student.sessionVersion,
              mfaVerified: true,
            },
            true,
          );
          if (!session) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              code: "SESSION_BRIDGE_FAILED",
              message: "Could not prepare passkey enrollment.",
            });
          }

          const user = {
            id: student.id,
            name: student.displayName,
            email: student.email,
            emailVerified: student.emailVerified,
            image: student.profileImage,
            createdAt: student.createdAt,
            updatedAt: student.updatedAt,
            studentId: student.studentId,
            role: student.role,
            isActive: student.isActive,
            sessionVersion: student.sessionVersion,
          };

          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  };
}

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleProvider =
  isBetterAuthGoogleEnabled(process.env)
    ? {
        google: {
          clientId: googleClientId!,
          clientSecret: googleClientSecret!,
          accessType: "offline" as const,
          prompt: "select_account" as const,
          mapProfileToUser(profile: {
            email?: string | null;
            email_verified?: boolean | null;
          }) {
            if (!isVerifiedGoogleIdentity(profile)) {
              throw APIError.from("FORBIDDEN", {
                code: "GOOGLE_EMAIL_NOT_VERIFIED",
                message: "Google must verify the account email before sign-in.",
              });
            }
            return { emailVerified: true };
          },
        },
      }
    : {};

const passkeyRp = getPasskeyRelyingParty();

export const auth = betterAuth({
  appName: "VisionQuest",
  basePath: "/api/better-auth",
  secret: getBetterAuthSecret(),
  database: prismaAdapter(prismaAdmin, { provider: "postgresql" }),
  trustedOrigins: getTrustedOrigins(),
  socialProviders: googleProvider,
  user: {
    modelName: "student",
    fields: {
      name: "displayName",
      emailVerified: "emailVerified",
      image: "profileImage",
    },
    additionalFields: {
      studentId: { type: "string", required: true, input: false },
      role: {
        type: "string",
        required: true,
        input: false,
        defaultValue: "student",
      },
      isActive: {
        type: "boolean",
        required: true,
        input: false,
        defaultValue: true,
      },
      sessionVersion: {
        type: "number",
        required: true,
        input: false,
        defaultValue: 0,
      },
      authProvider: {
        type: "string",
        required: false,
        input: false,
      },
    },
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },
  account: {
    modelName: "authAccount",
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      allowDifferentEmails: false,
      // Migration-only compatibility: legacy users predate a local
      // email-verification flag. Google itself is still required to return a
      // verified email before an account can be linked.
      requireLocalEmailVerified: false,
    },
  },
  session: {
    modelName: "authSession",
    expiresIn: SEVEN_DAYS_SECONDS,
    updateAge: ONE_DAY_SECONDS,
    cookieCache: { enabled: false },
    additionalFields: {
      sessionVersion: {
        type: "number",
        required: true,
        input: false,
        defaultValue: 0,
      },
      mfaVerified: {
        type: "boolean",
        required: true,
        input: false,
        defaultValue: false,
      },
    },
  },
  verification: {
    modelName: "authVerification",
    storeIdentifier: "hashed",
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            studentId: createStudentId(),
            role: "student",
            isActive: true,
            sessionVersion: 0,
            authProvider: "better-auth",
          },
        }),
      },
    },
    session: {
      create: {
        before: async (session) => {
          const student = await prismaAdmin.student.findUnique({
            where: { id: session.userId },
            select: {
              isActive: true,
              role: true,
              mfaEnabled: true,
              sessionVersion: true,
            },
          });
          if (!student?.isActive) return false;
          return {
            data: {
              ...session,
              sessionVersion: student.sessionVersion,
              mfaVerified:
                session.mfaVerified === true ||
                !requiresStaffMfaHandoff(student.role, student.mfaEnabled),
            },
          };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!requiresVerifiedBetterAuthSession(ctx.path)) return;

      const current = await getSessionFromCtx(ctx, {
        disableRefresh: true,
      });
      if (!current) {
        throw APIError.from("UNAUTHORIZED", {
          code: "SESSION_REQUIRED",
          message: "Sign in before managing your account.",
        });
      }

      const student = await prismaAdmin.student.findUnique({
        where: { id: current.user.id },
        select: {
          isActive: true,
          role: true,
          mfaEnabled: true,
          sessionVersion: true,
        },
      });
      const session = current.session as typeof current.session & {
        sessionVersion?: number;
        mfaVerified?: boolean;
      };
      if (
        !student ||
        !student.isActive ||
        student.sessionVersion !== (session.sessionVersion ?? -1)
      ) {
        await ctx.context.internalAdapter.deleteSession(current.session.token);
        throw APIError.from("UNAUTHORIZED", {
          code: "SESSION_REVOKED",
          message: "Your session is no longer valid. Sign in again.",
        });
      }
      if (
        requiresStaffMfaHandoff(student.role, student.mfaEnabled) &&
        session.mfaVerified !== true
      ) {
        throw APIError.from("FORBIDDEN", {
          code: "MFA_HANDOFF_REQUIRED",
          message:
            "Complete multi-factor authentication before managing this staff account.",
        });
      }
    }),
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  plugins: [
    passkey({
      rpName: "VisionQuest",
      ...passkeyRp,
      schema: {
        passkey: { modelName: "authPasskey" },
      },
      registration: { requireSession: true },
    }),
    legacySessionBridge(),
  ],
});
