# Migration Baseline — Prod Reconciliation Runbook

**What changed:** the 64-migration history (which was not clean-DB reproducible — see `project_migration_history_drift`) was squashed into a single baseline `prisma/migrations/00000000000000_baseline`. CI now provisions a fresh DB from it and passes `rls.test.ts`.

**Why prod needs a manual step:** prod already contains every table, role, function, and policy (applied incrementally over time). Its `_prisma_migrations` table records the 64 old migrations, **not** the baseline. If Render runs `prisma migrate deploy` as-is, it sees the baseline as *pending*, tries to apply it, and fails (`relation "..." already exists`). Prod must be told the baseline is **already applied** — without running it.

---

## ⚠️ Required order: RESOLVE prod, THEN merge/deploy

Do **not** merge PR #64 and let Render auto-deploy before doing step 1. (A failed deploy won't take prod down — the running instance stays up — but it will block the deploy.)

### Step 1 — Mark the baseline applied on prod (before merge)

Run from a machine with the **admin** prod connection string (the `postgres` role, i.e. `ADMIN_DATABASE_URL`; the restricted `vq_app` cannot write `_prisma_migrations`). Check out the PR #64 branch so the baseline folder exists locally:

```bash
git fetch origin && git checkout fix/ci-direct-url
DATABASE_URL="<prod ADMIN_DATABASE_URL>" npx prisma migrate resolve --applied 00000000000000_baseline
```

Expected: `Migration 00000000000000_baseline marked as applied.`

This inserts one row into `_prisma_migrations` for the baseline. The 64 old rows remain (harmless — `migrate deploy` only acts on folder migrations that aren't recorded; it does not error on recorded migrations missing from the folder).

### Step 2 — Verify

```bash
DATABASE_URL="<prod ADMIN_DATABASE_URL>" npx prisma migrate status
```
Expect: baseline shown as applied, "Database schema is up to date" (it may note the 64 old migrations are no longer in the folder — cosmetic).

### Step 3 — Merge PR #64 and deploy

Merge to `main`. Render runs `prisma migrate deploy` → sees the baseline already applied → no pending migrations → deploy proceeds normally. **No schema change happens on prod** (the baseline is never executed there).

### Rollback

If anything looks wrong before merge, simply don't merge — prod is unchanged by step 1 except the one `_prisma_migrations` row (which is harmless and can be deleted: `DELETE FROM "visionquest"."_prisma_migrations" WHERE migration_name = '00000000000000_baseline';`).

---

## Other open PRs (#60–#63)

They branched from `main` before the baseline, so their branches still carry the old 64 migrations and lack the CI `DIRECT_URL` fix → their `verify` checks are red. After #64 merges:
1. Update each branch (merge `main` in, or rebase) — the migrations folder will reconcile to the baseline (those branches didn't touch migrations, so no conflict).
2. Their CI then runs the fixed workflow against the baseline → green.
3. Merge.

(Their application code is reviewed and green locally; only the shared CI/migration plumbing blocked them.)

---

## What the baseline contains (for future reference)
Single `00000000000000_baseline/migration.sql`, assembled as: schema DDL generated from `schema.prisma` (authoritative — includes tables that had no prior CREATE migration) → RLS role `vq_app` + grants + `managed_student_ids` → the RLS policy migrations replayed in dependency order (recovery + recursion-fix `DROP/CREATE` self-resolve to net state, and define `instructor_class_ids`/`enrolled_class_ids`) → RLS for `SageInsight` + `JobScrapeRun`/`JobScrapeSourceResult` → idempotent role/permission seeds → the self-guarding `pg_cron` block (no-op without the extension, e.g. CI). Future migrations proceed normally on top of this baseline.
