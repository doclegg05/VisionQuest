# Fix Plan: Codex Review Findings (April 1, 2026)

Codex reviewed all changes from the April 1 session. 0 critical, 2 high, 4 medium, 4 low issues found. This plan addresses all HIGH and MEDIUM items; LOW items are noted for future cleanup.

---

## HIGH Priority

### H1: Readiness report `completedGoalLevels` uses planning goals, not completed goals

**File:** `src/app/api/teacher/reports/readiness-monthly/route.ts` lines 143-148

**Problem:** `completedGoalLevels` is built from `planningGoals` (which includes `active`, `in_progress`, `blocked`, AND `completed` via `goalCountsTowardPlan()`). This inflates the readiness score by awarding goal-planning credit for unfinished goals.

**Fix:** Build `completedGoalLevels` from `completedGoals` only:

```typescript
// BEFORE (wrong):
const completedGoalLevels: string[] = [];
for (const g of planningGoals) {
  if (!completedGoalLevels.includes(g.level)) {
    completedGoalLevels.push(g.level);
  }
}

// AFTER (correct):
const completedGoalLevels: string[] = [];
for (const g of completedGoals) {
  if (!completedGoalLevels.includes(g.level)) {
    completedGoalLevels.push(g.level);
  }
}
```

**Verify:** `computeReadinessScore` only awards goal-planning points for levels where at least one goal is completed.

---

### H2: Readiness report `month` parameter is ignored

**File:** `src/app/api/teacher/reports/readiness-monthly/route.ts` lines 34-49

**Problem:** `startDate`/`endDate` are computed from the `month` query param but never used in any Prisma query. The report always returns the current snapshot regardless of requested month.

**Fix:** This is a design decision. Two options:

**Option A (simple, recommended):** Remove the `month` parameter entirely. The report is a "current state" snapshot, not a historical report. Remove `startDate`/`endDate` computation and always report current state. Rename to make this clear.

**Option B (full):** Filter goals by `createdAt` within the date range, filter orientation progress by completion date, etc. This is significantly more complex and may not match how teachers actually use the report.

**Recommended:** Option A. Remove unused date parameters and document that this is a point-in-time snapshot.

---

## MEDIUM Priority

### M1: CredlyConnect hard-coded color classes break dark mode

**File:** `src/components/certifications/CredlyConnect.tsx` lines 166, 175, 227

**Problem:** `hover:bg-red-50`, `text-red-600`, `text-emerald-600` are hardcoded Tailwind colors that won't adapt to dark mode. The rest of the component correctly uses CSS custom properties.

**Fix:** Replace with token-based styles:

```tsx
// Disconnect button (line 166):
// BEFORE: className="... hover:bg-red-50 ..."
// AFTER:  remove hover:bg-red-50, use style={{ ':hover': ... }} or a CSS class

// Error text (lines 175, 230):
// BEFORE: className="... text-red-600"
// AFTER:  className="... text-[var(--error)]" (or define --error token if missing)

// Success text (line 227):
// BEFORE: className="... text-emerald-600"
// AFTER:  className="... text-[var(--success)]" (or define --success token if missing)
```

**Note:** Check if `--error` and `--success` tokens exist in `globals.css`. If not, add them to both light and dark themes.

---

### M2: Readiness report reads wrong streak path from progression state

**File:** `src/app/api/teacher/reports/readiness-monthly/route.ts` line 128

**Problem:** Code reads `state.streaks?.daily?.longest` but the canonical `ProgressionState` (in `engine.ts` line 87) stores `longestStreak` at the top level.

**Fix:**

```typescript
// BEFORE:
longestStreak = state.streaks?.daily?.longest || 0;

// AFTER:
longestStreak = state.longestStreak || 0;
```

---

### M3: CSP dual-source ambiguity

**Files:** `next.config.ts` (static CSP), `src/proxy.ts` (nonce-based CSP), `src/app/layout.tsx` (reads nonce)

**Problem:** `next.config.ts` now adds a static CSP with `'unsafe-inline'` for scripts. Meanwhile `proxy.ts` generates nonce-based CSP and `layout.tsx` reads `x-csp-nonce`. The proxy currently isn't wired as middleware (Turbopack+standalone bug), but if it gets wired in the future, two CSP headers with different policies would conflict.

**Fix:** Add a comment in `proxy.ts` noting that `next.config.ts` provides a static fallback CSP. When middleware is re-enabled, remove the static CSP from `next.config.ts`. No code change needed now — just documentation clarity.

```typescript
// In proxy.ts, add at the top:
// NOTE: A static fallback CSP is defined in next.config.ts headers().
// When this proxy is wired as middleware.ts, remove the static CSP
// from next.config.ts to avoid dual-header conflicts.
```

---

### M4: OAuth redirect_uri derived from request URL when env var missing

**Files:** `src/app/api/auth/google/route.ts` line 7, `src/app/api/auth/google/callback/route.ts` line 12

**Problem:** When `GOOGLE_REDIRECT_URI` is unset, the code derives it from `req.url`. This makes OAuth correctness depend on reverse proxy headers rather than a pinned config value.

**Fix:** Require `GOOGLE_REDIRECT_URI` in production:

```typescript
const redirectUri = process.env.GOOGLE_REDIRECT_URI;
if (!redirectUri) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("GOOGLE_REDIRECT_URI must be set in production");
  }
  // Fall back to req.url derivation only in development
  redirectUri = new URL("/api/auth/google/callback", req.url).toString();
}
```

---

## LOW Priority (document, fix later)

### L1: CredlyConnect setTimeout not cleared on unmount
**File:** `src/components/certifications/CredlyConnect.tsx` line 90
**Fix:** Store timeout ID in a ref, clear in cleanup.

### L2: Cron route query doesn't exclude `abandoned` goals
**File:** `src/app/api/cron/goal-stale-detection/route.ts` line 40
**Fix:** Add `"abandoned"` to `notIn` array.

### L3: Cron route leaks error detail in response
**File:** `src/app/api/cron/goal-stale-detection/route.ts` line 168
**Fix:** Return generic message in non-dev environments: `detail: process.env.NODE_ENV === "development" ? message : undefined`

### L4: Login audit event not awaited
**File:** `src/app/api/auth/login/route.ts` line 31
**Fix:** Add `await` before `logAuditEvent(...)`.

---

## Execution Order

1. **H1 + H2 + M2** (readiness report — all in same file, one commit)
2. **M1** (CredlyConnect dark mode tokens)
3. **M3** (CSP documentation comment)
4. **M4** (OAuth redirect_uri guard)
5. **L1-L4** (batch low-priority cleanup)
6. **Build verification** (`tsc --noEmit`, `npm test`, `npm run build`)
