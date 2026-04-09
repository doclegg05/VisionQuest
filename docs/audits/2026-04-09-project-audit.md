# VisionQuest Project Audit — 2026-04-09

**Scope:** Full project audit — security, correctness, and operational readiness
**Sources:** Three independent agent audits merged (Claude Code, Gemini Security, Gemini Remediation)

## Verification Status

| Check | Result |
|-------|--------|
| `npm run typecheck` | Passing (0 errors) — after adding `ai_provider_api_key` to `SYSTEM_CONFIG_KEYS` |
| `npm run lint` | Passing (58 warnings — unused imports/variables) |
| `npm test` (node:test) | 47 tests passing |
| `npx playwright test` | 18/18 E2E passing — after regex and rate-limit assertion fixes |
| `npx prisma validate` | Fails locally — `DIRECT_URL` env var missing from `.env.local` (pre-existing) |
| `npm run build` | Not verified (Google Fonts fetch blocked in sandbox) |

---

## CRITICAL

### 1. Local AI provider API key stored in plaintext

The admin AI-provider route saves `apiKey` through the **plain** config setter instead of the **encrypted** secret path. The Gemini API key already uses encrypted storage — the Ollama key should too.

**Evidence:**
- `src/app/api/admin/ai-provider/route.ts:41` — calls `setPlainConfigValue("ai_provider_api_key", ...)`
- `src/lib/ai/provider.ts:27` — reads via `getPlainConfigValue("ai_provider_api_key")`
- `src/lib/system-config.ts` — has `setConfigValue()` (AES-encrypted) and `getConfigValue()` (decrypts)

**Impact:** The Ollama bearer token is readable as plaintext in the database. Database compromise, backup exposure, or accidental admin-side disclosure exposes a live credential.

**Fix:** Use `setConfigValue()` for writes and `getConfigValue()` for reads — same path as `gemini_api_key`.

*Found by: Claude Code (CRITICAL), Gemini Security (High)*

---

## HIGH

### 2. RLS enabled in migrations but not wired into runtime queries

Checked-in migrations and planning docs assume authenticated Prisma queries will inject `app.current_*` GUC values, but the live Prisma client is a plain `PrismaClient` with no query extension or admin/client split.

**Evidence:**
- `prisma/migrations/20260403060000_rls_remaining_tables/migration.sql:7` — RLS policies exist
- `docs/plans/supabase-optimization.md:182` — describes intended runtime wiring
- `src/lib/db.ts:16` — plain `PrismaClient`, no GUC injection
- `.env.example:8` — `DATABASE_URL` points at `postgres` role (bypasses RLS)

**Impact:** The app relies entirely on app-layer `where` clauses for tenant isolation. If any route misses a `studentId` filter, the database will not fail closed. The `postgres` role bypasses RLS entirely.

**Fix (choose one):**
- **A)** Finish RLS runtime wiring: add Prisma extension or dual-client setup per the Supabase optimization plan
- **B)** Document that RLS is not yet an active security boundary and remove the false confidence from migration comments
- Update `.env.example` to reflect the intended runtime role separation

*Found by: Gemini Security*

---

## MEDIUM

### 3. Admin webhooks allow broad outbound SSRF targets

Webhook URLs are validated only as generic `http`/`https` URLs, then the server POSTs to them directly. An admin can point webhooks at internal/loopback/metadata endpoints.

**Evidence:**
- `src/lib/validation.ts:3` — URL validation is permissive
- `src/app/api/admin/webhooks/route.ts:25` — stores any valid URL
- `src/lib/webhooks.ts:54` — fetches the URL server-side

**Impact:** Admin-only, but enables SSRF against internal network, cloud metadata (`169.254.169.254`), and loopback services.

**Fix:** Block localhost, loopback, RFC1918 private ranges, link-local, and cloud metadata endpoints. Consider an allowlist if webhook destinations are limited.

*Found by: Gemini Security*

### 4. Test runner mismatch — vitest tests not runnable via default command

The AI provider tests import `vitest`, which is not installed. The default `npm test` uses Node's built-in runner.

**Evidence:**
- `src/lib/ai/__tests__/gemini-provider.test.ts:1` — `import { describe, it, expect } from 'vitest'`
- Same for `health.test.ts`, `ollama-provider.test.ts`, `provider.test.ts`

**Impact:** `npm test` exits non-zero on these files. Contributors may assume the whole suite passed when only a subset runs.

**Fix:** Either add `vitest` as a dependency with a matching script, or rewrite the AI tests to use `node:test` + `node:assert` like the rest of the repo.

*Found by: Gemini Security*

### 5. Non-null assertion on response body without guard

`res.body!.getReader()` will throw on a `null` body (possible with a 200 from a misconfigured reverse proxy).

**Evidence:**
- `src/lib/ai/ollama-provider.ts:81`

**Fix:**
```typescript
if (!res.body) throw new Error("Ollama returned empty stream body");
const reader = res.body.getReader();
```

*Found by: Claude Code*

### 6. SSE JSON parse not guarded

`JSON.parse(payload)` in the SSE stream handler throws on malformed data, killing the entire stream. Ollama can send non-JSON lines (comments, keep-alives).

**Evidence:**
- `src/lib/ai/ollama-provider.ts:99`

**Fix:** Wrap in try/catch, `continue` on parse failure.

*Found by: Claude Code*

### 7. Sequential DB reads in provider resolution

Three separate `getPlainConfigValue()` calls are awaited sequentially, adding ~30-60ms per chat message on cold cache.

**Evidence:**
- `src/lib/ai/provider.ts:19-27` — three sequential awaits
- `src/app/api/admin/ai-provider/route.ts:16-19` — same pattern but correctly uses `Promise.all()`

**Fix:** Use `Promise.all()` to parallelize the three reads.

*Found by: Claude Code*

### 8. Empty messages array not guarded

`messages[messages.length - 1]` is `undefined` if `messages` is empty. No guard exists.

**Evidence:**
- `src/lib/ai/gemini-provider.ts:39-40`, `:57`, `:86`

**Fix:** Add early return or throw if `messages.length === 0`.

*Found by: Claude Code*

---

## LOW / SUGGESTIONS

### 9. Error messages expose Ollama internals

Error throws like `Ollama request failed (${res.status}): ${text}` include the full Ollama error body. If this bubbles to the client, it reveals server infrastructure details.

**Fix:** Ensure API route catches provider errors and returns a generic message to the client.

*Found by: Claude Code*

### 10. `OLLAMA_API_KEY` env var fallback undocumented

`ollama-provider.ts:30` reads `process.env.OLLAMA_API_KEY` as a fallback, but this env var isn't documented anywhere. The admin UI is the intended config path.

**Fix:** Document it in `.env.example` or remove the fallback.

*Found by: Claude Code*

### 11. GET handler could return API key presence indicator

The GET handler at `/api/admin/ai-provider` correctly doesn't return the API key, but the admin UI can't tell if one is configured.

**Fix:** Return `hasApiKey: boolean` so the UI can show status.

*Found by: Claude Code*

### 12. 58 ESLint warnings (unused imports/variables)

Not security or correctness issues, but worth cleaning up in a separate pass.

*Found by: Gemini Security, Gemini Remediation*

### 13. `DIRECT_URL` env var missing from `.env.local`

`npx prisma validate` fails locally. Pre-existing issue, not from recent changes.

*Found by: Claude Code*

---

## Fixes Already Applied (by Gemini Remediation Agent)

| Fix | File | Detail |
|-----|------|--------|
| Added `ai_provider_api_key` to config keys | `src/lib/system-config.ts` | Fixed TypeScript error (but did not address encryption — see finding #1) |
| Updated teacher registration test regex | `public-routes.spec.ts`, `teacher-dashboard.spec.ts` | `/teacher registration/i` → `/(teacher\|staff) registration/i` |
| Updated student login rate-limit assertion | `student-login-chat.spec.ts` | Now expects either invalid-credentials or rate-limit error |

---

## Summary

| Severity | Count | Immediate Action Required |
|----------|-------|--------------------------|
| CRITICAL | 1 | Yes — encrypt API key before committing |
| HIGH | 1 | Yes — resolve RLS gap (wire or document) |
| MEDIUM | 6 | Should fix before next release |
| LOW | 5 | Optional cleanup |

## Recommended Fix Order

1. **Finding #1** — Switch API key to encrypted storage (5 min, blocks commit)
2. **Finding #4** — Standardize test runner (blocks CI reliability)
3. **Finding #2** — Decide on RLS strategy and document (architectural decision)
4. **Findings #5-8** — Code hardening in `ollama-provider.ts` and `gemini-provider.ts`
5. **Finding #3** — SSRF protection for webhooks
6. **Findings #9-13** — Cleanup pass
