# Catalog Operations Runbook

Operator process for growing the OKF (org-knowledge) catalog and activating
orphaned `ProgramDocument` rows for Sage RAG. As of 2026-07-02: 463 of 513
`ProgramDocument` rows have `usedBySage=false`; the catalog has 22 approved
nodes (18 forms + 3 documents, 0 certifications). This is the repeatable
batch loop for closing that gap safely, a few documents at a time.

## Prerequisites

- `.env.local` with a working `DATABASE_URL`/`DIRECT_URL` (read/write — this
  loop writes to the DB via `catalog:sync -- --apply`).
- `npx prisma generate` run against the current schema.
- Familiarity with `config/catalog-allowlist.json` (which forms/documents/
  certifications/platforms get a catalog node at all) and
  `catalog/{forms,documents,certifications,platforms}/*.md` (the nodes).

## The batch-activation loop

Work in batches of **5–15 documents**. Smaller batches keep curation and
review tractable; larger batches make a bad batch expensive to unwind.

### a. Pick candidates

```
npm run sage:rag:audit
npm run sage:rag:audit -- --categories=ORIENTATION,CERTIFICATION_INFO
npm run sage:rag:audit -- --audiences=STUDENT
```

Prints candidate counts by category and note quality (empty/weak/good) and
an "activation-ready sample." Prefer categories the audit flags as gaps,
docs with decent existing `sageContextNote` content (less curation work),
and docs real traffic suggests students ask about. Note each candidate's
exact `storageKey` — the allowlist keys off storageKey, not title.

### b. Add to the allowlist + generate draft nodes

Add the chosen storage keys to `documents` in
`config/catalog-allowlist.json`, then:

```
npm run catalog:generate
```

Creates a draft `catalog/documents/<slug>.md` per new key, pre-filled with
`vq_status: draft` and hard-identity fields pulled live from the
`ProgramDocument` row. Re-running on an existing node only refreshes hard
fields — your hand-curated body is preserved.

### c. Hand-curate

Edit `## When to use` / `## When NOT to use` (and `## Related`, linking
other nodes by relative path). `catalog:validate` requires `## When to use`
to be non-empty once `vq_status: approved` — write real guidance first, then
flip `vq_status: draft` → `approved`.

### d. Validate

```
npm run catalog:validate
```

Checks required fields, parity against source of truth (forms.ts / DB),
cross-link integrity, allowlist parity both directions, and the
empty-`whenToUse`-on-approved rule. Fix everything before proceeding — this
is the same check CI runs (DB-free portion) as a hard gate on every PR.

### e. Sync (writes `sageContextNote` + `usedBySage`)

```
npm run catalog:sync              # dry run — prints what WOULD change
npm run catalog:sync -- --apply   # writes for real
```

Always dry-run first. `--apply` downloads each doc's bytes, extracts text,
runs the PII scan, and only if clean embeds + writes `sageContextNote`. Docs
that fail the PII scan or have unavailable source bytes are skipped with a
`SKIP` line and left untouched — read the output, don't assume it all landed.

### f. Backfill embeddings

```
npm run sage:rag:backfill
```

Ensures newly-synced docs have current embeddings (idempotent — only
touches changed content).

### g. Drift check

```
npm run catalog:drift
```

Confirms every approved node's expected `sageContextNote` matches the DB.
Zero findings means step (e) landed cleanly. Needs a real, populated
`DATABASE_URL` — not part of the CI hard gate for that reason (see below);
run it locally each loop, and it also runs on schedule in `sage-evals.yml`
once an operator configures a real `DATABASE_URL` secret there.

### h. Regression gate + golden fixtures

```
npm run sage:rag:harness -- --strict-clean
```

Replays the fixed question set in `config/sage-rag-top-questions.json`
against the same `getDocumentContext()` Sage chat uses; `--strict-clean`
fails if any previously-clean question stops resolving. **Before running
for a new batch, add a fixture entry per newly-activated document** — a
realistic question, `expectedTerms`, and `expectedStorageKeys`/
`acceptableStorageKeys` pointing at the new doc(s). Activation without a
fixture is unverified.

### i. Commit

Commit `config/catalog-allowlist.json`, the new/changed `catalog/**/*.md`
nodes, and the fixture additions together in **one commit** — they're one
unit of catalog growth. Run the secret scan on the diff first (paths only).

## Rollback

If an activated document turns out wrong, don't hand-edit the DB — flip it
back via the teacher API:

```
PATCH /api/teacher/documents/sage-context
Body: { "documentId": "<id>", "usedBySage": false }
```

This stops retrieval immediately (the route invalidates the
`sage:documents` cache prefix on every write) without losing the
`sageContextNote` or the catalog node — re-enable later the same way, or via
`catalog:sync -- --apply` once the node is corrected. If the node itself is
wrong, revert `vq_status` to `draft`, fix it, and re-run from step (d).

## CI wiring

- **`catalog:validate` is a hard gate in `.github/workflows/ci.yml`**, run
  as `npx tsx scripts/catalog/validate.mjs --no-db`. Only the
  `program_document` node type's parity check needs a live DB (to diff
  against `ProgramDocument` rows); everything else — form-vs-`forms.ts`
  parity, cert/platform nodes, required fields, cross-link integrity,
  allowlist reverse-parity for forms/certs/platforms — is filesystem-only.
  `--no-db` skips just the DB-dependent portion and prints an explicit
  `::notice` naming what and how many nodes were skipped; nothing is
  silently dropped. Run `npm run catalog:validate` (no flag) locally with a
  real `DATABASE_URL` for the full check including document parity.
- **`catalog:drift` runs in `.github/workflows/sage-evals.yml`**, gated to
  `workflow_dispatch`/nightly `schedule` only (live-DB, informational, not a
  PR gate). No-ops with a `::notice` when no `DATABASE_URL` secret is
  configured, matching the existing `GEMINI_API_KEY`/`OLLAMA_URL` no-op
  guards in that workflow. No new secret was added — an operator must
  configure a real `DATABASE_URL`/`DIRECT_URL` repo secret for this job to
  do more than print the notice.

## Post-response efficiency: reviewed, no action (Phase 7 finding)

- **Title-fold**: conversation titles are generated deterministically (no AI
  call in the title path), so a "fold title-generation into the main
  response" optimization has no call to fold. Void — the premise was wrong.
- **Goals+mood batching**: combining the goal-extraction and mood-detection
  background calls was considered and declined — the blast radius of a
  combined-call regression (breaking both together instead of
  independently) outweighs the marginal saving at current traffic.

Revisit only if `npm run sage:usage:summary` shows the `sage_post.*`
callSites (`sage_post.goals`, `sage_post.mood`, `sage_post.discovery`,
`sage_post.classroom`) dominating real production traffic — not before.
