# Security Remediation Plan

> **STATUS: COMPLETE (verified 2026-04-17).** All 8 tasks were already landed in prior commits by the time this plan was revisited. Task 1's premise was wrong — Next.js 16 renamed `middleware.ts` to `proxy.ts`; `src/proxy.ts` IS the wired middleware (build output confirms `ƒ Proxy (Middleware)`), and `next.config.ts` was already cleaned of `unsafe-inline`. Tasks 2–8 verified via two parallel Explore agents against file:line evidence. Do not re-execute.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITICAL and HIGH security findings from the 2026-04-15 audit — activate CSRF/CSP middleware, add Sentry PII scrubbing, harden auth rate limiting, and close input validation gaps.

**Architecture:** All changes are surgical fixes to existing files. No new features, no schema changes, no UI modifications. The middleware activation is a one-file creation that wires existing dead code. Rate limiting and input validation fixes add constraints to existing route handlers.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 6, Zod, Sentry SDK, jsonwebtoken

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/middleware.ts` | Wire proxy.ts as Next.js middleware (CSRF + CSP) |
| Modify | `next.config.ts:24-42` | Remove `unsafe-inline` CSP fallback, update comments |
| Create | `src/lib/sentry-scrub.ts` | Shared PII scrubbing helper for Sentry |
| Modify | `sentry.client.config.ts` | Add `beforeSend` PII scrubbing |
| Modify | `sentry.server.config.ts` | Add `beforeSend` PII scrubbing |
| Modify | `sentry.edge.config.ts` | Add `beforeSend` PII scrubbing |
| Modify | `src/lib/auth.ts:24-29,53-59` | Pin JWT algorithm, enforce secret length |
| Modify | `src/app/api/auth/login/route.ts:11` | Add per-user rate limiting |
| Modify | `src/app/api/auth/mfa/verify/route.ts:20` | Add rate limiting |
| Modify | `src/app/api/auth/mfa/disable/route.ts:20` | Add rate limiting |
| Modify | `src/app/api/auth/mfa/backup-codes/route.ts:13` | Add rate limiting |
| Modify | `src/app/api/auth/register-teacher/route.ts:19-23` | Fix timing-safe compare length leak |
| Modify | `src/app/api/chat/send/route.ts:31-41` | Sanitize error message to client |
| Modify | `src/app/api/certifications/route.ts` | Add Zod validation for PATCH body |
| Modify | `src/app/api/portfolio/route.ts` | Add Zod schemas for POST/PUT bodies |
| Modify | `src/app/api/settings/api-key/route.ts` | Use existing `apiKeySchema` |
| Modify | `src/app/api/admin/webhooks/route.ts` | Add Zod schemas for POST/PUT bodies |
| Modify | `src/app/api/teacher/students/[id]/reset-password/route.ts` | Add Zod schema with password max-length |

---

## Task 1: Activate CSRF + CSP Middleware (CRITICAL)

**Files:**
- Create: `src/middleware.ts`
- Modify: `next.config.ts:24-42`

`src/proxy.ts` already implements CSRF origin validation and nonce-based CSP but is dead code — no `middleware.ts` exists to wire it. This single file activates both protections.

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
export { proxy as middleware, config } from "./proxy";
```

- [ ] **Step 2: Update `next.config.ts` — remove `unsafe-inline` and fix misleading comment**

Replace lines 24-41 with:

```typescript
          // Nonce-based CSP is handled by src/middleware.ts (via src/proxy.ts).
          // This static fallback applies only if middleware fails to execute.
          // It is intentionally restrictive — no unsafe-inline.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://images.credly.com https://www.credly.com",
              "connect-src 'self' https://generativelanguage.googleapis.com https://*.ingest.sentry.io",
              "frame-src 'none'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
```

- [ ] **Step 3: Build and verify middleware activates**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | grep -i middleware`

Verify: `middleware.js` appears in build output. If standalone mode blocks middleware, the fallback CSP (now without `unsafe-inline`) still improves security.

- [ ] **Step 4: Test CSRF protection locally**

Start dev server, then test a cross-origin POST is rejected:

```bash
curl -X POST http://localhost:3000/api/goals \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.com" \
  -d '{"test": true}'
```

Expected: `403 Forbidden: origin mismatch`

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts next.config.ts
git commit -m "fix: activate CSRF + nonce CSP middleware — proxy.ts was dead code"
```

---

## Task 2: Add Sentry PII Scrubbing (HIGH)

**Files:**
- Create: `src/lib/sentry-scrub.ts`
- Modify: `sentry.client.config.ts`
- Modify: `sentry.server.config.ts`
- Modify: `sentry.edge.config.ts`

TANF/SNAP student PII must never reach Sentry. Add `beforeSend` hooks to all three configs.

- [ ] **Step 1: Create shared scrubbing helper `src/lib/sentry-scrub.ts`**

```typescript
import type { Event } from "@sentry/nextjs";

/**
 * Strip PII from Sentry events before transmission.
 * VisionQuest handles TANF/SNAP recipients — no student data should reach Sentry.
 */
export function scrubPii(event: Event): Event {
  // Strip user PII
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }

  // Strip cookies and auth headers from request
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
      delete event.request.headers["x-forwarded-for"];
    }
  }

  // Scrub breadcrumb messages that may contain PII (email patterns)
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = breadcrumb.message.replace(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
          "[EMAIL_REDACTED]",
        );
      }
    }
  }

  return event;
}
```

- [ ] **Step 2: Update `sentry.client.config.ts`**

```typescript
import * as Sentry from "@sentry/nextjs";
import { scrubPii } from "./src/lib/sentry-scrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NODE_ENV,
    beforeSend: scrubPii,
  });
}
```

Note: The import path for the client config at the project root needs to be `"./src/lib/sentry-scrub"` (relative, not `@/`).

- [ ] **Step 3: Update `sentry.server.config.ts`**

```typescript
import * as Sentry from "@sentry/nextjs";
import { scrubPii } from "./src/lib/sentry-scrub";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    beforeSend: scrubPii,
  });
}
```

- [ ] **Step 4: Update `sentry.edge.config.ts`**

Same as server config — identical content.

- [ ] **Step 5: Verify build succeeds**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add src/lib/sentry-scrub.ts sentry.client.config.ts sentry.server.config.ts sentry.edge.config.ts
git commit -m "fix: add Sentry PII scrubbing — protect TANF/SNAP student data"
```

---

## Task 3: Harden Login Rate Limiting (HIGH)

**Files:**
- Modify: `src/app/api/auth/login/route.ts:9-14`

Add a secondary per-user rate limit so distributed IP attacks can't brute-force a single account.

- [ ] **Step 1: Add per-user rate limit after user lookup**

In `src/app/api/auth/login/route.ts`, after line 23 (where `student` is resolved), add:

```typescript
  // Per-user rate limit — prevents distributed brute force against a single account
  if (student) {
    const userRl = await rateLimit(`login:user:${student.id}`, 5, 15 * 60 * 1000);
    if (!userRl.success) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 },
      );
    }
  }
```

This runs AFTER the IP check (line 11) and AFTER user lookup (line 21-23), so:
- IP brute-forcing 1000 different accounts: blocked by IP limit (10/15min)
- 1000 IPs targeting one account: blocked by user limit (5/15min)
- No account enumeration: 429 only fires if user exists AND limit exceeded, but the generic login failure on line 41 is the same message

- [ ] **Step 2: Test rate limiting works**

Run the app locally. Make 6 login attempts with wrong password for the same user from the same IP. The 6th attempt should return 429 (user limit of 5 reached before IP limit of 10).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "fix: add per-user rate limiting on login — prevent distributed brute force"
```

---

## Task 4: Add Rate Limiting to MFA Endpoints (HIGH)

**Files:**
- Modify: `src/app/api/auth/mfa/verify/route.ts:20`
- Modify: `src/app/api/auth/mfa/disable/route.ts:20`
- Modify: `src/app/api/auth/mfa/backup-codes/route.ts:13`

These endpoints accept TOTP codes but have no rate limiting, enabling brute-force of the 6-digit code space.

- [ ] **Step 1: Add rate limiting to `mfa/verify/route.ts`**

Add import at top: `import { rateLimit } from "@/lib/rate-limit";`

Add as first line inside the handler (after `export const POST = withTeacherAuth(async (session, req: NextRequest) => {`):

```typescript
  const rl = await rateLimit(`mfa-verify:${session.id}`, 5, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }
```

- [ ] **Step 2: Add rate limiting to `mfa/disable/route.ts`**

Add import at top: `import { rateLimit } from "@/lib/rate-limit";`

Add as first line inside the handler:

```typescript
  const rl = await rateLimit(`mfa-disable:${session.id}`, 5, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }
```

- [ ] **Step 3: Add rate limiting to `mfa/backup-codes/route.ts`**

Add import at top: `import { rateLimit } from "@/lib/rate-limit";`

Add as first line inside the handler:

```typescript
  const rl = await rateLimit(`mfa-backup:${session.id}`, 3, 5 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/mfa/verify/route.ts src/app/api/auth/mfa/disable/route.ts src/app/api/auth/mfa/backup-codes/route.ts
git commit -m "fix: add rate limiting to MFA verify, disable, and backup-code endpoints"
```

---

## Task 5: Pin JWT Algorithm and Enforce Secret Length (MEDIUM)

**Files:**
- Modify: `src/lib/auth.ts:24-29,53-59`

Prevents algorithm confusion attacks and weak secrets.

- [ ] **Step 1: Enforce JWT_SECRET minimum length**

In `src/lib/auth.ts`, replace the `getJwtSecret()` function (lines 24-30):

```typescript
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return secret;
}
```

- [ ] **Step 2: Pin algorithm on `jwt.sign`**

In `signToken` (line 54), change:

```typescript
return jwt.sign({ sub: studentId, role, sv: sessionVersion }, getJwtSecret(), {
  expiresIn: TOKEN_TTL,
  algorithm: "HS256",
});
```

- [ ] **Step 3: Pin algorithm on `jwt.verify`**

In `verifyToken` (line 59), change:

```typescript
const payload = jwt.verify(token, getJwtSecret(), {
  algorithms: ["HS256"],
}) as Partial<SessionClaims>;
```

- [ ] **Step 4: Find and update `signMfaSessionToken` and `verifyMfaSessionToken` with same algorithm pinning**

Search for these functions in `src/lib/auth.ts` and apply the same `algorithm: "HS256"` / `algorithms: ["HS256"]` options.

- [ ] **Step 5: Verify app still starts with existing JWT_SECRET**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && export $(grep -v '^#' .env.local | xargs) && node -e "require('./src/lib/auth.ts')" 2>&1 || echo "Check .env.local JWT_SECRET length"`

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts
git commit -m "fix: pin JWT to HS256 and enforce 32-char minimum secret length"
```

---

## Task 6: Fix Timing-Safe Compare Length Leak (MEDIUM)

**Files:**
- Modify: `src/app/api/auth/register-teacher/route.ts:19-24`

The `timingSafeCompare` function short-circuits on length mismatch, leaking key length via timing.

- [ ] **Step 1: Replace `timingSafeCompare` with HMAC-based comparison**

In `src/app/api/auth/register-teacher/route.ts`, replace lines 19-24:

```typescript
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = crypto.createHmac("sha256", "vq-key-compare").update(a).digest();
  const bufB = crypto.createHmac("sha256", "vq-key-compare").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
```

Both values are HMAC'd to a fixed 32-byte length before comparison, eliminating the length leak.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/auth/register-teacher/route.ts
git commit -m "fix: eliminate timing leak in teacher key comparison — use HMAC normalization"
```

---

## Task 7: Sanitize Chat Error Response (MEDIUM)

**Files:**
- Modify: `src/app/api/chat/send/route.ts:31-41`

Raw AI provider error messages are returned to the client, potentially leaking internal config.

- [ ] **Step 1: Replace raw error with generic message**

In `src/app/api/chat/send/route.ts`, replace lines 28-41:

```typescript
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "AI provider unavailable";
    const isOffline = errorMsg.includes("Local AI server") || errorMsg.includes("not configured");

    logger.error("AI provider initialization failed", { error: errorMsg, studentId: session.id });

    return new Response(
      JSON.stringify({
        error: isOffline
          ? "Sage is offline right now. The local AI server is not reachable. Please try again later."
          : "Sage is temporarily unavailable. Please try again in a moment.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
```

The raw `errorMsg` is now logged server-side only, never sent to client.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/send/route.ts
git commit -m "fix: sanitize AI provider error — log internally, return generic message to client"
```

---

## Task 8: Add Zod Validation to Remaining Routes (HIGH)

**Files:**
- Modify: `src/app/api/certifications/route.ts`
- Modify: `src/app/api/portfolio/route.ts`
- Modify: `src/app/api/settings/api-key/route.ts`
- Modify: `src/app/api/admin/webhooks/route.ts`
- Modify: `src/app/api/teacher/students/[id]/reset-password/route.ts`

These routes use raw `req.json()` instead of the project's `parseBody(req, schema)` pattern.

- [ ] **Step 1: Add Zod schema and use `parseBody` in `certifications/route.ts` PATCH handler**

Find the PATCH handler's `req.json()` call and replace with:

```typescript
const certUpdateSchema = z.object({
  requirementId: z.string().cuid(),
  completed: z.boolean().optional(),
  fileId: z.string().cuid().optional(),
  notes: z.string().max(2000).optional(),
});

// Inside handler:
const body = await parseBody(req, certUpdateSchema);
```

Add imports: `import { z } from "zod"` and `import { parseBody } from "@/lib/schemas"` (if not already present).

- [ ] **Step 2: Add Zod schemas to `portfolio/route.ts` POST and PUT handlers**

```typescript
const portfolioCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(["project", "resume", "achievement", "skill", "certification", "other"]),
  fileId: z.string().cuid().optional(),
  url: z.string().url().max(2000).optional(),
});

const portfolioUpdateSchema = portfolioCreateSchema.partial().extend({
  id: z.string().cuid(),
});
```

Replace `req.json()` calls with `parseBody(req, portfolioCreateSchema)` and `parseBody(req, portfolioUpdateSchema)`.

- [ ] **Step 3: Use existing `apiKeySchema` in `settings/api-key/route.ts`**

Replace the raw `req.json()` with:

```typescript
import { parseBody, apiKeySchema } from "@/lib/schemas";
// ...
const body = await parseBody(req, apiKeySchema);
```

- [ ] **Step 4: Add Zod schemas to `admin/webhooks/route.ts`**

```typescript
const webhookCreateSchema = z.object({
  url: z.string().url().max(2000),
  eventTypes: z.array(z.string().max(100)).min(1).max(20),
});

const webhookUpdateSchema = z.object({
  id: z.string().cuid(),
  url: z.string().url().max(2000).optional(),
  eventTypes: z.array(z.string().max(100)).min(1).max(20).optional(),
  active: z.boolean().optional(),
});
```

- [ ] **Step 5: Add Zod schema to `teacher/students/[id]/reset-password/route.ts`**

```typescript
const resetPasswordSchema = z.object({
  newPassword: z.string().min(6).max(200),
});

// Replace req.json() with:
const body = await parseBody(req, resetPasswordSchema);
```

The `.max(200)` prevents the PBKDF2 DoS from extremely long passwords (100K+ chars).

- [ ] **Step 6: Run ESLint to check for issues**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npx eslint src/app/api/certifications/route.ts src/app/api/portfolio/route.ts src/app/api/settings/api-key/route.ts src/app/api/admin/webhooks/route.ts`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/certifications/route.ts src/app/api/portfolio/route.ts src/app/api/settings/api-key/route.ts src/app/api/admin/webhooks/route.ts "src/app/api/teacher/students/[id]/reset-password/route.ts"
git commit -m "fix: add Zod validation to 5 routes using raw req.json()"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full ESLint check**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npx eslint .`

Expected: Same 35 pre-existing `@typescript-eslint/no-explicit-any` errors only — no new errors.

- [ ] **Step 2: Run Prisma validate**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && export $(grep -v '^#' .env.local | xargs) && npx prisma validate`

Expected: "The schema at prisma/schema.prisma is valid"

- [ ] **Step 3: Run test suite**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npm test`

Expected: All tests pass.

- [ ] **Step 4: Start dev server and smoke test**

Run: `cd c:/Users/Instructor/Dev/VisionQuest && npm run dev`

Verify:
1. Login works (student and teacher)
2. Chat with Sage works
3. CSRF rejection works (cross-origin POST returns 403)
4. No console errors about CSP violations on normal pages

- [ ] **Step 5: Push to trigger Render deploy**

```bash
git push origin main
```
