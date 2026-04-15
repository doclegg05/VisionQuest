# Sprint Cleanup: Fix Tests, Commit Pending Work, Deploy & Configure Ollama

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get VisionQuest to green (all tests passing, ESLint clean at baseline, pending schema/deps committed), deploy to Render, and configure the local Ollama AI provider through the admin panel.

**Architecture:** Four streams: (0) commit all 29 dirty source files in logical groups first, (A) fix 4 failing tests, (B) commit schema + deps, (C) deploy and configure Ollama. Stream 0 must complete before A starts (tests need source committed). A and B can then run in parallel. C depends on the final push.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 6, Node test runner, Render.com, Ollama via a stable public tunnel (recommended: Cloudflare Tunnel)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Commit | `src/lib/mfa.ts` | verifyTotp returns `{valid, counter}`, replay protection |
| Commit | `src/lib/password-reset.ts` | HMAC-based token hashing |
| Commit | `src/app/api/auth/mfa/verify/route.ts` | Destructure new verifyTotp shape + mfaLastUsedCounter |
| Commit | `src/app/api/auth/mfa/challenge/route.ts` | Same |
| Commit | `src/app/api/auth/mfa/disable/route.ts` | Same |
| Commit | `src/app/api/auth/mfa/backup-codes/route.ts` | Same |
| Commit | `src/app/api/auth/google/callback/route.ts` | Cryptographic id_token verification |
| Commit | `package.json` + `package-lock.json` | google-auth-library dep |
| Commit | `prisma/schema.prisma` + migration | mfaLastUsedCounter column |
| Commit | 16 component files | console.error sanitization |
| Modify | `src/app/api/auth/mfa/backup-codes.test.ts:123` | Fix verifyTotp mock return shape |
| Modify | `src/lib/password-reset.test.ts:5` | Add API_KEY_ENCRYPTION_KEY env setup |
| None | Render deploy | Push triggers auto-deploy |
| None | Admin UI / API | Configure Ollama provider URL |

---

## Stream 0: Commit All Pending Source Changes (MUST run first)

### Task 0a: Commit MFA replay protection (source + schema + routes)

**Context:** `src/lib/mfa.ts` changed `verifyTotp()` to return `{ valid: boolean; counter: number | null }` and accept an optional `lastUsedCounter` param. The 4 MFA route files were updated to destructure this new shape and pass `mfaLastUsedCounter`. The schema gained `mfaLastUsedCounter Int?` on Student. These must be committed together as one logical unit.

**Files:**
- Commit: `src/lib/mfa.ts`
- Commit: `src/app/api/auth/mfa/verify/route.ts`
- Commit: `src/app/api/auth/mfa/challenge/route.ts`
- Commit: `src/app/api/auth/mfa/disable/route.ts`
- Commit: `src/app/api/auth/mfa/backup-codes/route.ts`
- Commit: `prisma/schema.prisma`
- Commit: `prisma/migrations/20260415100000_add_mfa_last_used_counter/migration.sql`

- [ ] **Step 1: Validate Prisma schema**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && npx prisma validate`

Expected: No errors.

- [ ] **Step 2: Stage and commit**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git add src/lib/mfa.ts src/app/api/auth/mfa/verify/route.ts src/app/api/auth/mfa/challenge/route.ts src/app/api/auth/mfa/disable/route.ts src/app/api/auth/mfa/backup-codes/route.ts prisma/schema.prisma prisma/migrations/20260415100000_add_mfa_last_used_counter/migration.sql && git commit -m "feat: add TOTP replay protection — verifyTotp returns {valid, counter}, mfaLastUsedCounter column"
```

---

### Task 0b: Commit Google OAuth hardening

**Context:** `src/app/api/auth/google/callback/route.ts` was updated to verify Google id_tokens cryptographically using `google-auth-library` instead of manual JWT decoding. The dependency was added to `package.json`.

**Files:**
- Commit: `src/app/api/auth/google/callback/route.ts`
- Commit: `package.json`
- Commit: `package-lock.json`

- [ ] **Step 1: Stage and commit**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git add src/app/api/auth/google/callback/route.ts package.json package-lock.json && git commit -m "fix: verify Google id_token cryptographically via google-auth-library"
```

---

### Task 0c: Commit password-reset HMAC change

**Context:** `src/lib/password-reset.ts` was updated to use HMAC-based hashing with `API_KEY_ENCRYPTION_KEY` instead of plain SHA-256.

**Files:**
- Commit: `src/lib/password-reset.ts`

- [ ] **Step 1: Stage and commit**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git add src/lib/password-reset.ts && git commit -m "fix: use HMAC-based hashing for password reset tokens"
```

---

### Task 0d: Commit console.error sanitization across components

**Context:** ~16 component files had `console.error` calls updated to sanitize error objects, preventing PII from leaking into browser consoles.

**Files:**
- Commit: all modified component files in `src/components/`

- [ ] **Step 1: Review and stage all component changes**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git diff --name-only HEAD -- src/components/ | xargs git add && git commit -m "fix: sanitize console.error calls across components — prevent PII leaks"
```

---

## Stream A: Fix Failing Tests (Agent Team — 2 parallel agents)

### Task 1: Fix MFA backup-codes test mock (3 test failures)

**Context:** `verifyTotp()` was updated to return `{ valid: boolean; counter: number | null }` instead of a plain `boolean`. The test mock at line 123 still returns `true`, causing destructuring to yield `undefined` for `valid` — routes return 401 instead of 200. Three tests fail: "stores only hashed backup codes when MFA is enabled", "clears backup codes when MFA is disabled", and "regenerates backup codes after a valid TOTP check".

**Files:**
- Modify: `src/app/api/auth/mfa/backup-codes.test.ts:123`

- [ ] **Step 1: Fix the `verifyTotp` mock return value**

In `src/app/api/auth/mfa/backup-codes.test.ts`, line 123, replace:

```typescript
    mockVerifyTotp.mock.mockImplementation(() => true);
```

with:

```typescript
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: true, counter: 1 }));
```

This matches the actual `verifyTotp` signature: `{ valid: boolean; counter: number | null }`.

- [ ] **Step 2: Run the MFA test file to confirm all 6 tests pass**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && npx tsx --test --experimental-test-module-mocks src/app/api/auth/mfa/backup-codes.test.ts`

Expected: 6 tests pass, 0 fail. The three previously-failing tests ("stores only hashed backup codes when MFA is enabled", "clears backup codes when MFA is disabled", "regenerates backup codes after a valid TOTP check") now pass because the mock returns an object with `valid: true` instead of a bare `true`.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git add src/app/api/auth/mfa/backup-codes.test.ts && git commit -m "fix: update verifyTotp mock to return {valid, counter} object shape"
```

---

### Task 2: Fix password-reset test (1 test failure)

**Context:** `password-reset.test.ts` calls `generatePasswordResetToken()` which internally calls `getTokenHmacSecret()` requiring `API_KEY_ENCRYPTION_KEY` env var. The test doesn't set it, so it throws: `"API_KEY_ENCRYPTION_KEY is required for password reset token hashing"`.

**Files:**
- Modify: `src/lib/password-reset.test.ts:5`

- [ ] **Step 1: Add env var setup before the test**

In `src/lib/password-reset.test.ts`, replace the entire file with:

```typescript
import assert from "node:assert/strict";
import { before, after } from "node:test";
import test from "node:test";
import { generatePasswordResetToken, hashPasswordResetToken } from "./password-reset";

let originalKey: string | undefined;

before(() => {
  originalKey = process.env.API_KEY_ENCRYPTION_KEY;
  if (!process.env.API_KEY_ENCRYPTION_KEY) {
    process.env.API_KEY_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  }
});

after(() => {
  if (originalKey === undefined) {
    delete process.env.API_KEY_ENCRYPTION_KEY;
  } else {
    process.env.API_KEY_ENCRYPTION_KEY = originalKey;
  }
});

test("password reset tokens are generated with a future expiry and stable hashes", () => {
  const beforeTs = Date.now();
  const { token, tokenHash, expiresAt } = generatePasswordResetToken();

  assert.ok(token.length > 20);
  assert.equal(tokenHash, hashPasswordResetToken(token));
  assert.ok(expiresAt.getTime() > beforeTs);
});
```

Note: the local variable was renamed from `before` to `beforeTs` to avoid shadowing the `before` import from `node:test`.

- [ ] **Step 2: Run the password-reset test to confirm it passes**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && npx tsx --test src/lib/password-reset.test.ts`

Expected: 1 test pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git add src/lib/password-reset.test.ts && git commit -m "fix: set API_KEY_ENCRYPTION_KEY in password-reset test env setup"
```

---

## Convergence: Full Test Suite + ESLint

### Task 3: Run full test suite and ESLint

**Depends on:** Tasks 0a-0d, 1, and 2 all complete.

- [ ] **Step 1: Run full test suite**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && npm test 2>&1 | tail -10`

Expected: `# pass 458`, `# fail 0` (all 458 tests pass).

- [ ] **Step 2: Run ESLint**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && npx eslint . 2>&1 | tail -5`

Expected: 35 pre-existing `@typescript-eslint/no-explicit-any` errors only. No new errors.

- [ ] **Step 3: Verify no uncommitted changes remain**

Run: `cd C:/Users/Instructor/Dev/VisionQuest && git status --short`

Expected: Only untracked files remain (plan docs, `remove_prompts.py`, `sage_local_ai_architecture.svg`, `.claude/settings.local.json`). No modified tracked files.

---

## Stream C: Deploy and Configure Ollama

### Task 4: Push to Render

**Depends on:** Task 3 passes.

- [ ] **Step 1: Push main to origin**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && git push origin main
```

Expected: Push succeeds. Render auto-deploys from main. Build runs `npm ci && npx prisma generate && npm run build`. Start command runs `npm run prisma:migrate:deploy && node .next/standalone/server.js`. The `mfaLastUsedCounter` migration will execute on deploy.

- [ ] **Step 2: Monitor Render deploy**

Check Render dashboard at https://dashboard.render.com or wait for the deploy webhook. Expect ~3-5 minute build time on free tier.

---

### Task 5: Configure Ollama local AI provider (MANUAL)

**Depends on:** Task 4 deploy is live. Ollama must be running on the dedicated local-AI host with a stable public tunnel endpoint.

**Prerequisites:**
1. Start Ollama on the dedicated host and verify `http://localhost:11434/api/tags`
2. Start the stable public tunnel (recommended: Cloudflare Tunnel) and note the HTTPS hostname
3. Verify the public endpoint works with the intended auth mode before saving it in VisionQuest

- [ ] **Step 1: Set local AI provider via admin UI or API**

Option A — Admin UI:
1. Log into VisionQuest as a teacher at https://visionquest.onrender.com
2. Navigate to Admin -> Program Setup -> AI Provider
3. Set provider to "Local AI Server"
4. Set URL to the stable public hostname (recommended: `https://llm.<your-domain>`)
5. Click Save

Option B — API:
```bash
curl -X PUT https://visionquest.onrender.com/api/admin/ai-provider \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<your-jwt-cookie>" \
  -d '{"provider": "local", "url": "https://<your-public-ollama-hostname>"}'
```

- [ ] **Step 2: Verify Sage works through Ollama**

1. Log in as a student
2. Open Sage chat
3. Send a message: "Hello Sage, are you running on a local model?"
4. Confirm response streams back successfully
5. Check Ollama terminal for incoming request logs

Expected: Sage responds coherently. Ollama terminal shows `gemma4:latest` inference activity.

- [ ] **Step 3: Verify fallback to Gemini if tunnel is down**

1. Stop the public tunnel or local AI host service
2. Send another message to Sage
3. Expected: Either a clear "Sage is offline" message (local provider unreachable) or automatic fallback to Gemini if configured

---

## Summary

| Stream | Tasks | Parallelizable | Agent Type |
|--------|-------|----------------|------------|
| 0: Commit source | 0a (MFA+schema), 0b (Google OAuth), 0c (password-reset), 0d (components) | Sequential (same working tree) | Main agent |
| A: Fix tests | Task 1 (MFA mock), Task 2 (password-reset env) | Yes — both independent | `build-error-resolver` |
| Converge | Task 3 (full suite + ESLint) | No — depends on 0+A | Main agent |
| C: Deploy | Task 4 (push), Task 5 (Ollama config) | Sequential | Main agent + manual |

**Agent team dispatch plan:**
- Main agent: Tasks 0a-0d sequentially (commits to same working tree, cannot parallelize)
- Agent 1 + Agent 2 (parallel): Task 1 (MFA mock) + Task 2 (password-reset env) after Stream 0 completes
- Main agent: Task 3 (verify), Task 4 (push), Task 5 (Ollama — manual with user)
