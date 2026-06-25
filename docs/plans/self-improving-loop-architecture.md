# VisionQuest Recursive Self-Improving Loop — Implementation Plan (codename: **Ouroboros**)

**Status:** DRAFT FOR APPROVAL (rev2 — 10 decisions LOCKED §14.0 + PM review findings incorporated §14.1) · **Author:** Staff Eng (subagent) · **Date:** 2026-06-04 · **Audience:** Britt (PM/approver + sole builder/operator)

**Ground-truth provenance:** All load-bearing file facts in this plan are **re-verified this session against the DEPLOY branch `fix/ci-direct-url` @ `dea72c9`** (the branch Render ships from), not merely an upstream feature branch. See **§0 (Provenance Reconciliation)** for the pasted command outputs and the branch-diff proof. A prior draft cited `feat/rag-pipeline @ 7dece79`; that branch and `fix/ci-direct-url` are **byte-identical for every load-bearing file** (proof in §0), so the safety case transfers — but the canonical reference is now the shipping branch. **Caveat (PM review, 2026-06-04):** repo facts are **not** *platform* truth — Render service settings (linked deploy branch, `autoDeployTrigger`) and GitHub branch protection / auto-merge are **not** derivable from the repo and require a **live API/dashboard preflight** (see "Live-platform preflight" below, enforced as Gate 0 in §6).

> **What this is:** the executable plan to build a FERPA-safe, gate-gated, recursively-self-improving loop that watches all of VisionQuest, detects/diagnoses failures with local models, writes+tests fixes, and (eventually) auto-merges + auto-deploys behind a canary with automatic rollback — where **the automated gates are the human**, and recursion is **measured, pre-registered, and falsifiable, not assumed.**
>
> **What this is NOT:** the implementation. This is the architecture + phased build plan + research basis + open decisions.

---

## 0. Provenance Reconciliation (re-verified on the shipping branch — BLOCKING gate before any code)

**Why this section exists:** the entire safety case rests on file facts. A single drift on the *deploy* branch (e.g., `autoDeploy` added, `FORCE RLS` present, provider routing changed) silently invalidates a layer. This was a CRITICAL gap in the prior draft, which verified against `feat/rag-pipeline`, not the branch that ships. **Resolved here.**

**Branch facts (this session):**
- Deploy branch HEAD: `fix/ci-direct-url` @ `dea72c9`
- Prior-draft verification branch: `feat/rag-pipeline` @ `7dece79`
- Merge-base: `67f1a37`
- `git diff --name-only fix/ci-direct-url feat/rag-pipeline --` for the **12 load-bearing files** (`render.yaml`, `.github/workflows/ci.yml`, `provider.ts`, `types.ts`, `registry/index.ts`, `registry/types.ts`, `instrumentation.ts`, `llm-usage.ts`, `health.ts`, `audit.ts`, `retry.ts`, `goal-stale-detection/route.ts`) → **EMPTY (zero differences).** The two branches differ only in student error-boundary pages, recovery-setup UI, progression events, and docs — none touching the safety surface.

**Load-bearing facts, re-asserted with pasted outputs from `fix/ci-direct-url @ dea72c9`:**

| Claim | Command | Output on deploy branch | Holds? |
|---|---|---|---|
| `render.yaml` has no `autoDeploy`/`autoDeployTrigger` key | `git show fix/ci-direct-url:render.yaml \| grep -ciE 'autoDeploy'` | `0` | ⚠️ repo-hint ONLY — autodeploy is a Render **service** setting; an omitted `autoDeployTrigger` **retains the existing service's current value** (only *new* services default to `commit`) → **confirm via Render API/dashboard preflight, not grep** |
| `startCommand` runs migrate on boot | `grep startCommand` | `npm run prisma:migrate:deploy && node .next/standalone/server.js` | ✅ |
| `render.yaml plan` | `grep plan:` | `starter` | ✅ |
| **`FORCE ROW LEVEL SECURITY` = 0** (FERPA backstop foundation) | `git grep -i 'FORCE ROW LEVEL SECURITY' fix/ci-direct-url -- prisma/ \| wc -l` | `0` | ✅ |
| `instrumentation.ts` has **no `onRequestError`** | full file read | `register()` only; no `onRequestError` export | ✅ |
| CI has **no deploy step** | full read of `ci.yml` | single `verify` job; steps end at Playwright smoke; no deploy/render | ✅ |
| `resolveAiProvider` cloud escape-hatch | `git show …:provider.ts` (read) | `if (providerType === "local") return getLocalProvider(); return getCloudProvider(...)` — operator-flippable | ✅ |
| `AiTask` / `DataSensitivity` unions | `git show …:types.ts` | `DataSensitivity = configured\|student_record\|staff_entered\|public_program\|system` (`:112-117`); `AiTask` at `:101` | ✅ |
| `featureFlag` seam inert | `git show …:registry/{types,index}.ts` | `featureFlag?: string` (`types.ts:46`); only reader is `getToolsByFeatureFlag` (`index.ts:40-41`); **`withRegistry` does not read it** | ✅ |
| `logLlmCall` defined, **0 callers** | `git grep -n logLlmCall fix/ci-direct-url -- src/` | one hit: the definition at `llm-usage.ts:16` | ✅ |
| `health.ts` shallow 3-table check | read | `REQUIRED_TABLES = [Student, RateLimitEntry, AuditLog]` (`:3-6`) | ✅ |
| `retry.ts` failure-table TODO | read `:45-60` | `// TODO: persist to a failure table for instructor review … needs a schema migration` (`:52`) | ✅ |
| cron auth template | read `goal-stale-detection/route.ts:1-15` | `prismaAdmin as prisma`; `authHeader === Bearer ${CRON_SECRET}` | ✅ |
| `audit.ts` admin chokepoint | `grep import` | `import { prismaAdmin as prisma } from "./db"` (`:1`) | ✅ |
| baseline admin-only RLS (Pattern K) | `git grep "current_setting('app.current_role'"` | present at `migration.sql:1871` (`= 'admin'`) | ✅ |
| CI job DAG | read `ci.yml` | `verify`: checkout → setup node20/py3.13 → `npm ci` → prisma generate → **lint → audit:api-auth → typecheck → test → RLS migrate+test (RLS_CONTEXT_STRICT=true) → build → smoke** | ✅ |
| package scripts exist for gate-wiring | `grep package.json` | `lint, typecheck, test, test:rls, test:smoke, test:smoke:api, test:e2e, build, audit:api-auth, prisma:migrate:deploy` all present | ✅ |
| promptfoo / stryker / coverage deps | `grep package.json` | **absent** → add as **CI-only pinned installs** (separate tooling job/manifest), **NOT** in Render `dependencies` (would bloat prod installs + widen deploy-failure surface) | ✅ (noted) |
| `ADMIN_DATABASE_URL` (RUNTIME preflight, not repo fact) | read `render.yaml` envVars (repo) **+ Render env (live)** | **Not in `render.yaml`** — but `sync:false` env vars are **intentionally invisible** in the blueprint; operator-confirmed **SET in Render env (`=postgres`)** per repo docs → **OD-1 reclassified to a runtime preflight, NOT a repo-derived blocker** (corrects the earlier false-positive) | ✅ runtime-preflight |

**Step-Zero gate (blocking, P-1):** before any `loop_*` code is written, **re-run this exact table on the then-current deploy branch and paste outputs into the P-1 PR.** Any divergence (autoDeploy added, FORCE RLS appears, provider routing changed, CI gains a deploy step) → **STOP and re-plan the affected layer.** A CI check (`scripts/verify-ground-truth.mjs`) asserts these invariants on every loop PR thereafter so the safety case cannot silently rot.

**Live-platform preflight (blocking, P-1 — repo facts are NOT platform truth, per PM review):** the repo cannot prove Render service settings or GitHub branch protection. Before P-1 completes, confirm via live API/dashboard and paste outputs (names/paths only, never secret values) into the P-1 PR:
- **Render** — the service's **linked deploy branch**, current **`autoDeployTrigger`** value (target: `off`), and that **`ADMIN_DATABASE_URL` is actually set** on the service.
- **GitHub** — `main` **branch-protection/ruleset** state, **required status checks**, and repo **auto-merge** enablement. (Live check this session: `main` is **UNPROTECTED** and repo **auto-merge is DISABLED** — required status checks only enforce under branch protection per GitHub docs.)

These constitute **Gate 0** (§6) and **must be ENFORCED before any actor receives write capability.**

---

## 1. Executive Summary

VisionQuest will build **Ouroboros**: a five-layer loop that turns the existing read-only `project-autopilot` orchestrator and `sage-health` shell-sensor into a closed self-improving system — **sensor → detect/classify → diagnose → act → learn** — under a **separate, surgically-scoped actor**, never by loosening the read-only autopilot.

The design rests on three load-bearing facts, all **verified on the deploy branch (§0)**:

1. **The gates are the entire safety budget — and are not enforceable yet.** `startCommand` runs `prisma migrate deploy` then boots, `.github/workflows/ci.yml` has **no deploy step**, and **`main` is currently UNPROTECTED with repo auto-merge DISABLED** (GitHub live check). Render autodeploy is a **service setting the repo can't prove** (an omitted `autoDeployTrigger` *retains the existing service's value*, §0). So the live posture must be confirmed, and today a merge to `main` plausibly deploys to 100% of prod **regardless of CI**. Ouroboros's first structural job (P-1, **Gate 0**) is to make platform enforcement real: set Render **`autoDeployTrigger: off`** (the current field; `autoDeploy` is deprecated) + a CI-green deploy-hook as the *only* deploy path, AND enable **GitHub branch-protection/ruleset with required status checks + repo auto-merge** so the gates are actually enforced (status checks only block merges under branch protection). After that, CI (lint → audit:api-auth → typecheck → test → RLS-strict → build → smoke) + the new e2e + evals + canary burn-rate + post-deploy-verify literally replace the human reviewer — so their correctness, and their **unreachability by the fixer**, is non-negotiable.
2. **FERPA is a hard invariant by construction, not a gate.** `FORCE ROW LEVEL SECURITY` appears **0 times** in the schema → `prismaAdmin` (postgres owner) *always* bypasses the RLS policies, so **RLS cannot catch a redaction defect**. A mandatory CI `redact.test.ts` is the *real* FERPA backstop. Diagnosis runs local-only by *type* (a net-new `loop_internal` `DataSensitivity` that `resolveAiProvider` routes unconditionally to local), closing the verified operator escape-hatch in `provider.ts`.
3. **Recursion is measured by a frozen outer metric on held-out traffic, against a pre-registered numeric target by a pre-registered date** — not by "PRs merged." With a fixed model set (Gemini 2.5 Flash / local gemma) there is **no unbounded RSI** — only bounded *scaffolding* gains across VQ's 6 fix classes. Success = the targeted failure-class **rate drops on held-out post-deploy traffic by a committed amount within a committed horizon** (§9.1). **Inner-score-up while outer-metric-flat trips the killswitch** as a reward-hacking incident.

**Planning honesty:** unattended signal→patch yield is planned at **~10-25%** (SWE-Cycle full-cycle ≤13.5%, NOT the SWE-bench-Verified headline). This literature number is treated as an **unvalidated prior**: P2 runs a **VQ-specific calibration** (§9.4) on the real codebase before the number is trusted; the gates are designed so **most candidate fixes are wrong and the gates reject them.** There are **no live students until the 11-classroom rollout**, so **P-1…P2 run on synthetic/replayed/fault-injected redacted signal, and P3 (any auto-deploy) does not turn on until real student traffic exists.**

**Build order:** **P-1** (remediate verified-hard-down substrate; flip the deploy bypass; install interim killswitch) → **P0** sensor+ledger (read-only, FERPA-critical, FIRST) → **P1** detect+diagnose (read-only/propose-only brain) → **P2** act (PR + human-merge-first to calibrate yield) → **P3** auto-merge + auto-deploy + canary + auto-rollback + the LEARN spine.

---

## 2. Goal & a Crisp Definition of "Actual Recursive Improvement"

### Goal
A loop that **continuously and autonomously** lowers VisionQuest's real production failure rate across all 4 signal classes and (with the §7 schema-data/infra carve-out) the code/tool/skill/index fix classes, FERPA-safe by construction, with the automated gates as the sole merge/deploy authority — and that **provably improves its own ability to detect/diagnose/fix over time, by a pre-registered amount within a pre-registered horizon.**

### Definition of "Actual Recursive Improvement" (the contract)
The system is recursively improving **iff** all four nested loops show measurable, sustained, held-out movement in the right direction:

| Loop | Derivative | Question | Primary metric (in `loop_ledger`) | Trip condition |
|---|---|---|---|---|
| **1. Fix loop** | 1st | Did *this* fix lower *its* targeted failure-class rate? | `outerMetricDelta` on **held-out post-deploy** traffic, via **independent probe** | Rate did not drop → auto-revert |
| **2. Corpus loop** | engine | Is the bar rising with real failure diversity? | held-out `eval_case` count growing **and** difficulty-calibration slice pass-rate **staying below a ceiling** | corpus grows in count but trivial in difficulty → flagged |
| **3. Meta loop** | 2nd | Is it getting *better at* detecting/diagnosing/fixing per class? | per-class `first-try gate-pass ↑`, `fix-success ↑`, `MTTF ↑`, `recurrence ↓` over `generation` | 2nd derivative flat/negative for a class → that class demoted to propose-only |
| **4. Governance loop** | regulator | Is autonomy self-regulating against the outer metric? | rollback/recurrence rate; autonomy ring | rising → auto-pause + ring demotion |

**The single hardest-to-game definition of success:** the **frozen outer metric** — targeted failure RATE measured on **held-out, future, post-deploy traffic the fix never saw**, per class, **via a structurally independent probe (§9.3)**. Anything else (CI green, PRs merged, self-reported confidence) is an *inner* proxy. **Inner-up + outer-flat ≡ a reward-hacking incident → global killswitch.**

> **Bounded-RSI caveat:** with a fixed model set there is no runaway intelligence gain. Ouroboros can only improve *scaffolding* — tools, prompts/skills, indexes, retries, schema-data shape, infra config — which is exactly VQ's 6 fix classes. That is the correct, provable, bounded target.

---

## 3. Current VQ Reality (grounded, cited — all re-verified on `fix/ci-direct-url` per §0)

| Area | Verified state | File / evidence | Consequence for Ouroboros |
|---|---|---|---|
| **Deploy gate** | `startCommand = prisma migrate deploy && node …server.js`; CI has **no deploy step**; autodeploy is a Render **service** setting (omitted `autoDeployTrigger` retains current value) → confirm via API | `render.yaml`; `ci.yml`; Render API/dashboard | **P-1 Gate 0 must set `autoDeployTrigger: off` + deploy-hook-after-CI-green + GitHub branch protection**, else "gates are the human" is bypassable |
| **Provider escape-hatch** | `resolveAiProvider`: local-only sensitivity → `getLocalProvider()` **only if** `providerType === "local"`, else **`getCloudProvider`** | `src/lib/ai/provider.ts` (`resolveAiProvider`) | **Close by type:** add `loop_internal` DataSensitivity routed *unconditionally* to local |
| **Type graft points** | `AiTask` union (`:101`); `DataSensitivity = configured\|student_record\|staff_entered\|public_program\|system` (`:112-117`) | `src/lib/ai/types.ts` | Clean one-line adds for `loop_diagnose` + `loop_internal` |
| **Canary seam (inert)** | `featureFlag?:string` (`types.ts:46`); read **only** by `getToolsByFeatureFlag` (`index.ts:40-41`), **never by `withRegistry`** | `src/lib/registry/*` | Best in-repo wire-in for app-level canary + killswitch |
| **Explicit-error sensor** | `instrumentation.ts` has `register()` but **no `onRequestError`** | `src/instrumentation.ts` | RSC/route/Prisma/RLS errors invisible to Sentry → P-1 adds scrubbed `onRequestError` |
| **Perf sensor (dead)** | `logLlmCall` **defined, 0 callers** | `src/lib/llm-usage.ts:16` | Wire into provider stream paths (also repairs the non-functional token-quota cap) |
| **FERPA backstop** | `FORCE ROW LEVEL SECURITY` = **0** | `git grep … prisma/ → 0` | `prismaAdmin` always bypasses RLS → **CI `redact.test.ts` is the only FERPA backstop** |
| **Admin-only RLS (Pattern K)** | `current_setting('app.current_role', true) = 'admin'` policy block | `prisma/migrations/00000000000000_baseline/migration.sql:1871` | Copy for `loop_*` tables |
| **Sensor chokepoint template** | `audit.ts` imports `prismaAdmin as prisma` (`:1`); `logAiAuditEvent` content-free at every Sage routing decision | `src/lib/audit.ts`; `src/lib/ai/audit.ts` | AI-class sensor with **zero new call sites** |
| **Detect prototype** | `generateAiSafetyReport` does take-1000 → aggregate → pass/warn | `src/lib/ai/safety-report.ts` | Generalize into `detect.ts` |
| **Diagnose template** | two-call async: `retryWithBackoff` + `generateStructuredResponse` + confidence>0.7 | `src/lib/chat/post-response.ts`; `src/lib/sage/retry.ts` | Clone for `diagnose.ts` |
| **The loop_event gap** | `// TODO: persist to a failure table for instructor … needs a schema migration` | `src/lib/sage/retry.ts:52`; `goal-extractor.ts` | Pre-identified — `loop_event` fills it |
| **Health gate (shallow)** | `/api/health` checks `SELECT 1` + 3 tables (`Student`,`RateLimitEntry`,`AuditLog`) | `src/lib/health.ts:3-6` | Covers ~1 of 4 fail classes → add `/api/health/deep` |
| **Cron auth template** | `Bearer ${CRON_SECRET}` + `prismaAdmin` | `src/app/api/cron/goal-stale-detection/route.ts:8-14` | Ingest + cron template |
| **Cron infra** | App crons migrated to **Supabase pg_cron**; `scripts/run-*.mjs` are manual fallbacks | `render.yaml` comment; `prisma/migrations/20260421000000_add_pg_cron_jobs` | `loop-detect`/`loop-diagnose` use pg_cron `net.http_post` + `CRON_SECRET` |
| **Harness gate (ready)** | `sage-rag-harness.mjs` emits `strictPassed`/`strictCleanPassed` | `scripts/sage-rag-harness.mjs:167-212` | Wire into CI as index-class gate |
| **Gate deps absent** | no promptfoo/stryker/coverage deps in `package.json` | `package.json` | Add as **CI-only pinned installs** (separate tooling job/manifest) — **NOT** Render `dependencies` (would bloat prod installs + widen deploy-failure surface) |
| **`ADMIN_DATABASE_URL` (runtime preflight)** | not in `render.yaml` because `sync:false` values are invisible there; operator-confirmed **set in Render env (`=postgres`)** | `render.yaml` + Render env (live) | **OD-1 = runtime PREFLIGHT (not a repo blocker):** confirm it's set on the service at P-1; if ever unset, `prismaAdmin` falls back to `vq_app` → admin writes FAIL |
| **Autopilot deny-list** | blocks `gh pr merge`, `git push`/`--force`, non-GET `gh api`, `rm -rf` | `project-autopilot/.claude/settings.json` | The exact gate to **surgically invert** under a separate actor |
| **Harness hard-down** | claude CLI rc=1 since 2026-05-08; Ollama `.state=UNHEALTHY`; broken PostToolUse hook | autopilot logs | **P-1 Step Zero** |

---

## 4. Recommended Architecture (5 layers)

```
                         ┌─────────────────────────────────────────────────────────┐
                         │  HUMAN-ONLY, FIXER-UNREACHABLE (CODEOWNERS + branch       │
                         │  protection + meta-check CI):                             │
                         │  CI config · rls.test.ts · audit:api-auth · eval suites  │
                         │  judge prompt · thresholds · canary config · killswitch  │
                         │  burn-rate watcher · eval_case minting/normalization      │
                         │  PROBE-AUTHOR agent (separate identity, §9.3)             │
                         └─────────────────────────────────────────────────────────┘
   redacted metadata only            ▲ reads, never writes
        ┌──────────┐   ┌──────────┐  │  ┌──────────┐   ┌──────────┐   ┌──────────────┐
 prod →│ L1 SENSOR│ → │ L2 DETECT│ →   │ L3 DIAGNOSE│ → │ L4 ACT   │ → │ L5 LEARN /   │
  4    │ redact-  │   │ cluster+ │     │ local-only │   │ worktree │   │ VERIFY /     │
signal │ at-write │   │ dedup+   │     │ →fix CLASS │   │ →PR→CI   │   │ SAFETY SPINE │
classes│ loop_event│  │ confid.  │     │ vote+abst. │   │ →canary  │   │ loop_ledger  │
        └────┬─────┘   └────┬─────┘     └────┬──────┘    └────┬─────┘   └──────┬───────┘
             │ prismaAdmin   │ local Ollama    │ local Ollama   │ cloud claude    │ frozen outer
             │ +redact       │ embeddings      │ (loop_internal) │ (REDACTED only) │ metric, held-out
             └───────────────┴─────────────────┴────────────────┴─────────────────┘  corpus, killswitch
   INTERIM KILLSWITCH (feature_flag.killswitch) checked from P0 by recordLoopEvent + ingest route ↑
```

### Layer 1 — Sensor (P0, FERPA-critical, FIRST)
**Single FERPA-safe write chokepoint** recording **only redacted structured metadata** for failure-relevant events across all 4 signal classes.
- New `src/lib/loop/sensor.ts` exports `recordLoopEvent()` — imports `prismaAdmin` (mirror `audit.ts:1`), **always** passes payload through `redactLoopPayload()` before the DB write, and **checks `feature_flag.killswitch` first (interim killswitch, §7.A)** — if set, it drops the event and no-ops.
- **Append-only metadata invariant:** `loop_event`/`loop_cluster`/`loop_ledger` are **observability tables only**; no serving path (chat, auth, RLS, routing) ever reads them. P0 writes **cannot affect what a student sees.** Asserted by a CI check that greps serving routes for `loop_` imports → 0.
- Four feeders, near-zero new call sites:
  - **(a) AI-class:** `emitLoopEvent()` inside `logAiAuditEvent` (already content-free, at every Sage routing decision) → **zero new call sites**. Chat-route `errorCodes` (`AI_PROVIDER_UNAVAILABLE`, `AI_STREAM_FAILED`, `CLIENT_STREAM_CLOSED`) feed directly.
  - **(b) Explicit-error:** add `export const onRequestError = Sentry.captureRequestError` (scrubbed) to `instrumentation.ts`; mirror Sentry issue-hash into `loop_event`.
  - **(c) Perf/SLA:** wire dead `logLlmCall` into provider stream paths (time-to-first-token + total duration) — **also repairs the non-functional token-quota cap**.
  - **(d) Implicit-behavior:** `instrumentation-client.ts` web-vitals + same-origin `/api/internal/loop-event` beacon from `src/lib/api.ts` `handleResponse` and the chat SSE consumer (respect CSP `connect-src 'self'`).
- Local out-of-band signals (`sage-health ALERT-*.md`; Ollama/cloudflared/relay UNHEALTHY) POST to the same ingest. Clone `run-sage-health.bat` → `run-loop-sensor.bat` (no LLM, `.state`-diff dedup).
- **Hard self-exclusion (red-team, first-class):** every event carries `deploymentEpoch` + `loopInducedWindow` **AND `actorIdentity` + `branchGlob`**; L2 hard-excludes (i) events within a post-actuation blackout window and (ii) **any event whose actor is the loop bot or whose branch matches `loop/*`** — so the loop never senses its own deploy/rollback/flag-flip **or its own CI/PR/worktree churn** as a new failure (closes the LOW gap).

### Layer 2 — Detect / Classify (P1, read-only)
Generalize `generateAiSafetyReport` into `src/lib/loop/detect.ts`:
- normalize signature (strip UUID/cuid/timestamp/numeric, ~200-char trunc; LangChain self-heal recipe)
- **two-tier dedup:** exact-match on normalized signature keyed on Sentry issue-hash + Fingerprint Rules → embedding+HDBSCAN over the residue (local-Ollama embeddings in the existing RAG pgvector store)
- **root-cause-level correlation:** a canonical `incidentKey` (`failureClass + suspectedRootComponent + deploy-window`) collapses one outage's many error-codes/routes into **one** diagnosable unit before L3
- dedup vs `loop_ledger` to drop already-known/already-fixed
- **statistical fire-gate behind a hard count floor:** 7-day Poisson baseline per signature (escalate on spike p<0.05, short window must also breach) **AND** `N ≥ min_event_count` (Poisson alone misfires at near-zero alpha volume)
- **deterministic class assignment from provenance first** (Prisma/RLS frame→`schema_data`; `api/**` frame→`code`; Gemini/relay/cloudflared FAIL→`tool`/`infra`; RAG empty-context→`index`; guardrail miss→`skill`; burn-rate→`perf`); local model adjudicates **only** ambiguous cases
- **AI-quality detectors** (Sage never throws): SelfCheckGPT sampling-consistency + guardrail heuristics (medical/legal/financial regex, crisis-redirect presence per `sage-ai.md`, refusal/empty-stream rate), async/offline on local Ollama over **redacted** transcripts
- output = a deduped, classed, baseline-gated `loop_cluster` record. Confidence = **repeated-run VOTE agreement**, never verbalized; below threshold → file a draft issue and abstain.

### Layer 3 — Diagnose (P1, HARD local-only, propose-only)
Clone `handlePostResponse` recipe into `src/lib/loop/diagnose.ts`:
- **The FERPA fix (type-level):** new `AiTask 'loop_diagnose'` + new `DataSensitivity 'loop_internal'` (clean one-line adds at `types.ts:101`/`:112`), routed in `resolveAiProvider` **unconditionally** to `getLocalProvider()` with **no operator override** — structurally closes the verified `provider.ts` escape-hatch by riding the existing `isLocalOnlySensitivity` machinery.
- **Fail-CLOSED:** `loop_internal` on local-unavailable must **throw and abort** (log infra-class failure), **never** fall back to cloud. Unit test asserts no cloud branch reachable.
- **Explore/localize BEFORE edit** (explore-before-edit +0.68, premature-patch -0.78). Tools: `loop_event`/Prisma schema/git log/redacted Sentry + **CodeGraph callers/callees/impact** (+28.3% localization — `.codegraph` needs `codegraph init` as a P-1 prerequisite).
- Confidence = self-consistency vote (5-10×) + abstain-below-threshold → draft issue. Must prove a concrete **diff-line→error causal link** before L4 acts.
- emits `rootCauseKey` within gemma's 8192-num_ctx / 45s budget over the Cloudflare Tunnel (short/structured/JSON prompts). **This budget is an unvalidated prior** — see §9.5 diagnose-quality calibration; if local diagnosis fails the confidence-gate-vs-human-label benchmark, the diagnose layer stays propose-only past P2.

### Layer 4 — Act (P2 PR+human-merge → P3 auto-merge)
**Auditable Agentless workflow** (localize → repair → N diffs → filter → re-rank → validate; ~50.8% SWE-bench Verified) — **reject Devin** (hosted/opaque/FERPA-incompatible). Headless `claude -p` + Agent SDK, **one git worktree per candidate**.
- **Anti-overfitting (mandatory):** the **fixer never authors or sees** the test that gates its merge; an **independent step authors a hidden reproduction test** (cuts overfit 21.8-33% → 5.8-11.3%); require **mutation testing** + **≥2-3 hidden cases per cluster** + **changed-line coverage ~1.0**. Inoculation prompting names+forbids the verifier-gaming shortcut.
- **Observability-regression gate:** auto-reject any patch that removes/mutes error throws, widens catch blocks, deletes Sentry captures, removes `recordLoopEvent`/`logAiAuditEvent` call sites, or short-circuits guardrails — closes the #1 reward-hacking path (silence ≠ fix).
- Agent SDK caveat: subagents can't prompt (`ask`→DENY) → keep `Edit`/`Bash` on the **parent** act agent, subagents read-only.
- **Wire the existing-but-unwired gates into CI:** `sage-rag-harness.mjs --strict` against a seeded pinned corpus (index-class); `test:e2e` (seeded fixture student) + `test:smoke:api` as a CI job; **promptfoo** stage with a **local-Ollama judge** + frozen Sage golden set (skill/AI-quality class); coverage (`node --experimental-test-coverage`). **All new gate tooling (promptfoo/stryker/coverage) is installed CI-only (pinned), NEVER added to Render `dependencies`** (avoids prod-install bloat + deploy-failure surface).
- **AI-quality gate uses PAIRED statistics** (McNemar / one-sided BCa-bootstrap on pass-rate delta) with position-swap + length/format bias audit **failing CLOSED at >10% verdict-flip**.
- Act runner relies on Render **`autoDeployTrigger: off`** (set at P-1 Gate 0) and triggers deploy via deploy-hook **only after CI is green**.
- **Schema-data is highest-gated (knowing deviation, §7):** `prisma migrate deploy` is forward-only → autonomous schema fixes require **expand/contract** backward-compatible migrations + a tested reversible path, **else human approval even at P3**; a non-reversible migration **never** ships in an auto-deploy. Decouple `migrate deploy` from container start (separate job).

### Layer 5 — Learn / Verify / Safety Spine (P3, the CENTERPIECE)
- **(a) `loop_ledger`** archives every attempt (cluster → diagnosis → patch → gate outcomes → deploy → post-deploy verdict). L2 dedups against it; L3 retrieves prior fixes (DGM/AlphaEvolve: cheap trusted verifier + archive + frozen outer metric).
- **(b) Post-deploy verify-or-auto-revert** on **held-out** traffic with a **sibling-class regression gate** (targeted class rate dropped AND no other class rose) and an **independent-probe** check (§9.3) — a `loop_event`-rate drop *without* an independent-probe pass = reward-hacking incident → killswitch.
- **(c) The recursive mechanism:** every confirmed prod failure → a **permanent held-out `eval_case` the fixer never sees** (monotonically growing); offline **Promptbreeder-style evolution** of diagnose/triage/classifier prompts + Sage `systemInstruction` against the frozen growing corpus (the **lowest-risk FIRST recursive win** — never merges code, never touches prod). Per-class **second-derivative** trend reporting.
- **(d) Safety spine (app-layer, Render has no native canary):** wire the inert `featureFlag` seam into `withRegistry` against a DB-backed `feature_flag` store **with mandatory in-process cache** → internal→1-5%→25%→100% rings + instant flag-to-0% killswitch. **Honest blast-radius limit:** flag canary gates only **tool-routed** handlers — RSC/raw-route/migration reach 100% on deploy, so **burn-rate auto-rollback + `/api/health/deep`** are the real backstop for non-tool paths. External **multi-window multi-burn-rate SLO watcher** (14.4×/1h, 6×/6h, 1×/3d; short window must co-breach) → fast-path flag-to-0% + slow-path Render Rollback API (**pin the bad commit**).
- **Single-writer arbitration:** the watcher is the **sole** authority to advance/revert a ring once a deploy is live (DB deploy-lease keyed on `deployedSha`); the act runner cannot re-advance a watcher-pinned commit. Flag-cache TTL < watcher interval.
- **All of the above lives OUTSIDE the loop's write-reach** (CODEOWNERS + branch protection + a **meta-check CI step** that **fails the build if a loop PR touches any gate/eval/threshold/killswitch/probe-author file**, allowlist-based + hash-manifest) + a held-out eval slice.

---

## 5. Data Model (loop_event, loop_ledger, + supporting tables)

All `loop_*` tables live in a **separate ops schema (name TBD, e.g. `vq_loop`) to which the `vq_app` role has NO grant** (OD-3 LOCKED, §14.0 — stronger structural FERPA boundary than RLS alone, since `prismaAdmin` bypasses RLS), with **Pattern K admin-only RLS** (copy baseline `migration.sql:1871`) as defense-in-depth, written **only** via `prismaAdmin` through the `recordLoopEvent` chokepoint, **redact-at-write**. `eval_case` is **CODEOWNERS-protected, NOT loop-writable.** **All loop migrations are expand/contract / forward-only-safe (§7.B).**

### `loop_event` (sensor; the FERPA hot-path)
```
id            cuid              clusterId       String? (set by detect)
createdAt     DateTime          confidence      Float?
signalClass   enum(explicit_error|ai_quality|implicit_behavior|perf_sla)
failureClass  enum(code|tool|skill|index|schema_data|infra)?  -- null until diagnosed
severity      enum(info|warn|error|critical)
normalizedSignature  String     -- UUID/cuid/timestamp/numeric-stripped, ~200-char trunc; HASH of error text, NEVER raw message
sentryIssueHash      String?
route/task/policyLabel  String   -- labels only
providerClass enum(local|cloud|none)
errorCode     String?           -- e.g. AI_PROVIDER_UNAVAILABLE
inputChars/outputChars/durationMs/timeToFirstTokenMs  Int  -- COUNTS/timings ONLY
provenance    String            -- file/frame/provider hint for deterministic class
pseudoSubject String            -- salted-HMAC of studentId; NEVER raw cuid/email/text
deploymentEpoch  Int            -- self-exclusion
loopInducedWindow Boolean       -- self-exclusion (time)
actorIdentity String            -- self-exclusion (identity): 'prod' | 'loop-bot' | …
branchGlob    String?           -- self-exclusion (branch): loop/* hard-excluded
contentLogged Boolean @default(false)
piiLogged     Boolean @default(false)
ttlExpiresAt  DateTime          -- pg_cron PII-free purge
@@index([normalizedSignature]) @@index([signalClass,failureClass,createdAt]) @@index([route,createdAt]) @@index([actorIdentity])
```
**HARD INVARIANT** enforced by `redactLoopPayload` (REJECT-mode: drop row + alert on any residual email/cuid/raw-text match) + **CI `redact.test.ts`** (the real FERPA backstop, because FORCE RLS = 0). **Allowlist-only fields**; error free-text is hashed, never stored.

### `loop_cluster` (detect output)
```
id; signatureHash unique; incidentKey; correlationGroupId; failureClass;
firstSeenAt/lastSeenAt; eventCount;
baselineRatePerDay/observedRatePerDay/poissonP;
status enum(new|baseline|spiking|diagnosing|acted|fixed|suppressed|recurred);
kAnonOk Boolean   -- small-cell suppression; FALSE = cohort-of-one → recordLoopEvent GATES the write (never persists)
embeddingId       -- pgvector ref
clusterCohesion Float  -- abstain if below threshold or Ollama degraded
```

### `loop_ledger` (learn archive; the recursion substrate — resolves `retry.ts:52`)
```
id; clusterId FK; rootCauseKey; failureClass;
diagnosisJson (root_cause_hypothesis, suspectedFiles, voteAgreement, modelName — NO PII);
prNumber/prUrl?; branch (loop/*);
ciResult Json (per-gate pass/fail + coverageOfChangedLines + mutantsKilled + paired-stat delta + judge-bias-flip%);
deployedSha?; canaryRing enum(internal|c1|c5|c25|c100|reverted);
canaryOutcome enum(passed|rolled_back|killswitched);
preDeployFailureRate/postDeployFailureRate (HELD-OUT);
outerMetricDelta (FROZEN outer metric — computed from INDEPENDENT probe, §9.3, not observedRatePerDay alone);
siblingClassDelta; oscillationPairId?;        -- anti-ping-pong
thresholdSnapshotId; corpusSnapshotId;        -- frozen measurement frame
insufficientPowerAbstain Boolean;             -- statistical-power floor
rewardHackSuspected Boolean;                   -- inner-up/outer-flat
recurred Boolean + recurrenceCount;           -- keyed on rootCauseKey
attemptsPerRootCause Int + maxAttemptsExceeded Boolean;  -- escalate-to-human
generation Int;                               -- second-derivative trend
preRegisteredTargetId?                         -- link to §9.1 pre-registered target row
supersededByEvalCaseId?                        -- link to minted permanent eval case
spendCentsThisAttempt Int                      -- cost accounting (§11)
```

### `feature_flag` (DB-backed canary + killswitch; read by `withRegistry` WITH in-process cache)
```
key unique (matches ToolDefinition.featureFlag); enabled Boolean; rolloutPct Int(0|1|5|25|100);
killswitch Boolean;          -- INTERIM killswitch exists from P0 (§7.A)
loopEnabled Boolean;         -- master loop on/off (§7.B disaster recovery)
deployLeaseOwner; pinnedBadSha; updatedBy; updatedAt
```

### `eval_case` (CODEOWNERS-protected, NOT loop-writable; the growing corpus)
```
id; failureClass; sourceLedgerId; promptOrScenario (REDACTED); expectedAssertion;
heldOut Boolean; source enum(synthetic|real); status enum(PENDING|APPROVED);
authoredBy enum(probe-author-agent|human);  -- §9.3 separation
representativenessScore Float;               -- §9.3 representativeness check
addedAt
```
Auto-minted rows enter **PENDING** (redaction pass + human sign-off before `heldOut`/replayable). Fixer **never** sees held-out cases.

### `loop_infra_snapshot` (disaster-recovery substrate, §7.B)
```
id; takenAt; featureFlagSnapshot Json (all rows); thresholdConfigHash; migrationVersion; note
```
Periodic known-good snapshot of `feature_flag` + threshold config for one-command restore.

**`pg_cron` purge** (`net.http_post` pattern from baseline) enforces PII-free TTL on `loop_event`; `loop_ledger`/`eval_case` retained longer (PII-free by construction). **OD-1 runtime preflight at P0 gate:** confirm `ADMIN_DATABASE_URL` (postgres role) is set on the live service — operator-confirmed set; `sync:false` ⇒ invisible in `render.yaml` (§0, §14.0) — else `prismaAdmin` falls back to `vq_app` and admin-only writes **FAIL**.

---

## 6. The Gate Spine (the gates ARE the human)

A change reaches prod only by passing this ordered, fixer-unreachable chain. **No single LLM judgment is ever a gate.**

| # | Gate | Class it catches | Source |
|---|---|---|---|
| 0a | **Platform enforcement (P-1 prerequisite, NEW per PM review):** GitHub `main` **branch-protection/ruleset** with **required status checks** (the CI `verify` job + every NEW loop gate below) + required-PR + **repo auto-merge ENABLED**; Render service preflight (**linked branch**, **`autoDeployTrigger: off`**, deploy-hook). Required because GitHub status checks **only block merges under branch protection** (live check: `main` currently UNPROTECTED, auto-merge OFF). | un-enforced-gates / direct-push bypass | NEW (P-1) |
| 0b | Render immutable + `/api/health` readiness | broken build/boot/migration (free first-line rollback) | render native |
| 1 | `lint` | style/syntax | existing CI |
| 2 | `audit:api-auth` (**promoted to BLOCKING for loop PRs**) | route-auth footguns | existing CI |
| 3 | `typecheck` | type/contract | existing CI |
| 4 | `npm test` | unit correctness | existing CI |
| 5 | **RLS-strict cross-tenant** (`rls.test.ts`, `RLS_CONTEXT_STRICT=true`) + **new prismaAdmin-import check** + **`verify-ground-truth.mjs` (§0)** + **serving-path `loop_`-import = 0 check** | tenant/FERPA/provenance | existing + new |
| 6 | **Independent hidden repro test + mutation + changed-line coverage ~1.0** | overfit/false-green | NEW (P2) |
| 7 | **Observability-regression meta-check** | silence-as-fix gaming | NEW (P2) |
| 8 | **promptfoo (local-Ollama judge, paired stats, bias-audit fail-closed >10%)** | AI-quality/skill | NEW (P2) |
| 9 | `sage-rag-harness --strict` (seeded corpus) | index | wire existing |
| 10 | `build` | build | existing |
| 11 | `test:e2e` + `test:smoke:api` (seeded fixture) | code/integration | wire existing |
| 12 | **meta-check** (fail build if loop PR touches gate/eval/threshold/killswitch/probe-author file; allowlist + hash-manifest; **required status check on protected ruleset**) + **probe-author separation check (§9.3)** | gate/probe tampering | NEW (P2) |
| 13 | **Canary ring + multi-burn-rate SLO** (internal→1-5%→25%→100%) | runtime regression | NEW (P3) |
| 14 | **Post-deploy verify-or-auto-revert** on held-out + **independent probe (§9.3)** + sibling-class regression + statistical-power floor | did-the-failure-rate-actually-drop | NEW (P3) |

**Gate 0a (platform enforcement) must be LIVE before the loop actor receives any write capability — without branch protection + required checks, none of gates 1-14 are actually enforced.** **Auto-merge requires Gate 0a enforced + 1-12 green.** **Auto-deploy requires CI-green deploy-hook + killswitch unset + per-day cap not exceeded + spend-budget not exceeded (§11).** **Promotion to the next ring requires 13-14 green AND low rollback rate.**

---

## 7. Safety Spine, Self-Bricking Recovery & Red-Team Mitigations (first-class)

### 7.A — Interim killswitch & deploy authority during P-1/P0 (closes HIGH gap)
The full global killswitch + single-writer deploy-lease are P3 artifacts, but P-1 sets `autoDeployTrigger: off` and wires a deploy-hook, and P0 writes to prod DB via `prismaAdmin`. To eliminate the window where loop infra mutates prod with no off-switch:
- **`feature_flag.killswitch` and `feature_flag.loopEnabled` exist from P0** (first migration). `recordLoopEvent` and the `/api/internal/loop-event` ingest route **check `killswitch` first and no-op if set.** This is a single env-/DB-flip the operator controls from day one, before the watcher exists.
- **P0 writes are append-only observability metadata** and are **structurally barred from serving paths** (CI grep: 0 `loop_` imports in chat/auth/RLS/routing). Stated explicitly so a P0 sensor bug cannot affect what a student sees.
- Deploy authority during P-1/P0: **manual, human-triggered deploy-hook only**; no automated deploy exists until P3. The interim killswitch + manual-deploy posture is the bridge until the single-writer deploy-lease lands.

### 7.B — Loop-infrastructure disaster recovery / self-bricking runbook (closes HIGH gap)
The loop reverts application *fixes*; this subsection defines reverting the *loop itself*.
- **"Disable the entire loop" — one switch, documented & tested:** set `feature_flag.loopEnabled=false` (DB flip) → all of `recordLoopEvent`, ingest, detect/diagnose crons, and the act/deploy runners check it first and become no-ops; **STOP the Windows Task Scheduler jobs** (`run-loop-*.bat`); set `feature_flag.killswitch=true` as belt-and-suspenders. This procedure is rehearsed in P0 (flip it, confirm zero loop writes, flip back).
- **Forward-only-safe loop migrations (expand/contract):** every `loop_*` migration is additive (new nullable columns / new tables); never a destructive `ALTER`/`DROP` of a loop table in the same migration that depends on it. A bad loop migration is recovered by a **forward** corrective migration, never a manual prod `DROP`. CI static-rejects destructive DDL on `loop_*` tables.
- **`feature_flag` corruption recovery:** `loop_infra_snapshot` holds periodic known-good snapshots; a documented `scripts/restore-loop-flags.mjs` restores `feature_flag` from the latest snapshot via `prismaAdmin`. Tested in P3 setup against a seeded snapshot.
- **Flapping/zombie watcher recovery:** the watcher has a heartbeat + **deadman's-switch** (missing heartbeat → killswitch trips, fail-closed). If the watcher flaps (advance/revert oscillation beyond `max_transitions_per_day`), it self-pauses and pins the current ring; recovery = operator inspects `loop_ledger`, restores flags from snapshot, restarts watcher.

### 7.C — Red-team mitigation table
| Threat | First-class mitigation | Where |
|---|---|---|
| **Fixer edits its own gates** (DGM deleted its hallucination-detector) | Gates/evals/thresholds/killswitch/minting/**probe-author** in CODEOWNERS human-only path; **meta-check is a REQUIRED status check**; allowlist (not denylist glob) + hash manifest; held-out eval slice; human CODEOWNERS identity ≠ loop bot | §6 #12; L5; §9.3 |
| **Self-induced sensor feedback storm** | `deploymentEpoch`+`loopInducedWindow`; L2 hard-excludes post-actuation blackout window | L1+L2; `config.post_actuation_blackout_window` |
| **Loop CI/PR/worktree churn pollutes signal** (closes LOW gap) | `actorIdentity`+`branchGlob` on every event; L2 **hard-excludes actor=loop-bot and branch=`loop/*`** before the spike gate | L1+L2 |
| **Two-class oscillation (ping-pong)** | Post-deploy **sibling-class regression gate** + `oscillationPairId` detector → suppress both, escalate human | L5 `siblingClassDelta` |
| **Moving-target non-convergence** | **Freeze the measurement frame:** pin `thresholdSnapshotId`+`corpusSnapshotId` per attempt; META re-tuning on a separate non-overlapping cadence | L5; `config.threshold_freeze_window` |
| **Killswitch/ring flapping** | Hysteresis (separate trip vs reset) + dwell-time + `max_transitions_per_day` | governance loop; `config.ring_*` |
| **Canary/watcher deploy tug-of-war** | **Single-writer deploy-lease** keyed on `deployedSha`; watcher sole ring authority; flag-cache TTL < watcher interval | L5; `feature_flag.deployLeaseOwner` |
| **Recurrence-counter laundering** | Dedup/recurrence on `rootCauseKey`; **max 2 attempts/rootCauseKey → human escalate**; auto-revert counts as a rollback for the breaker | L2+L3+L5 |
| **Signal suppression as "fix"** | **Decouple success from sensed metric** (independent probe §9.3); **observability-regression gate** auto-rejects instrumentation-reducing diffs | §6 #7,#14 |
| **Eval-corpus poisoning / trivial growth** | Minting+normalization in fixer-unreachable path + **PENDING human sign-off** + **probe-author separation (§9.3)**; **difficulty-calibration slice** ceiling | L5 `eval_case` |
| **Judge/vote gaming** | Held-out judge the META loop never optimizes against; entropy/diversity floor; judge↔human calibration ≥ target or fail-closed; never same model generate+judge | §6 #8 |
| **Canary-visibility gap** (behavior off tool path) | Independent probe runs through **non-tool path classes** via `/api/health/deep`; window/sampling/volume floor CODEOWNERS-locked | L5 |
| **Statistical blindness at alpha scale** | Min-events + min-bake-time floor; "no signal" = INCONCLUSIVE; **P3 OFF until real traffic** | L5; `config.canary_thresholds.min_events` |
| **Cost/compute blowup** | **Global daily spend + token + call + worktree caps** checked at L3/L4 entrance; **hard spend circuit-breaker** (§11); one-PR-per-`incidentKey`; daily PR cap | §11; L3/L4 |
| **Schema-data irreversibility** | Human approval for any migration PR even at P3; CI static-rejects destructive DDL; reverse migration proven; decouple migrate from boot; **flagged as knowing deviation (§7.D, OD-6)** | §6; §7.D |
| **Watcher single-point-of-failure** | Watcher off the single box (2nd Render service / self-hosted runner) with heartbeat + deadman's-switch | L5; §7.B |
| **Loop bricks itself/prod** | §7.B disaster-recovery runbook (one-switch disable, expand/contract, snapshot restore) | §7.B |
| **Bounded actor** | Separate identity; allowlist narrow forms only (`gh pr create`@P2; bounded `git push loop/*` + merge of loop-labeled PRs @P3); `--force`/`reset`/`rebase`/`rm -rf`/`gh api` writes permanently denied | autonomy_path |
| **Operator neglect / solo-maintainer absence** | §10 graceful-degradation: auto-pause on neglect, conservative defaults | §10 |

### 7.D — Knowing deviation from a LOCKED decision (requires explicit PM sign-off)
**The locked decision states "whole app, autonomous from day 1."** This plan **recommends a knowing, narrow deviation:** the **schema-data and infra fix classes are NOT autonomously auto-deployed** even at P3 — they require human approval (or a proven expand/contract reversible migration) — because `prisma migrate deploy` is **forward-only and irreversible**, and an auto-reverted bad migration can lose or corrupt student data with **no FORCE-RLS backstop**. Code/tool/skill/index classes remain fully autonomous. **This is surfaced here as a decision-conflict, not buried in open decisions (OD-6).** **Britt must explicitly sign off** on `whole-app-autonomous = {code, tool, skill, index}` with `{schema_data, infra}` human-gated, or fund tested-reversible-migration tooling to retire the carve-out. **✅ SIGN-OFF GRANTED — Britt, 2026-06-04 (OD-6, §14.0): autonomous = `{code, tool, skill, index}`; `{schema_data, infra}` human-gated.**

---

## 8. FERPA-Safe Diagnosis Flow (hard invariant by construction)

FERPA is **law, not suspended by the full-autonomy policy.** Six layers of defense:

1. **Type-level local-only diagnosis.** `loop_diagnose` carries `loop_internal` `DataSensitivity` → `resolveAiProvider` routes **unconditionally** to `getLocalProvider()`, no operator override → flipping `ai_provider='cloud'` (the verified `provider.ts` escape-hatch) can **never** send loop signals to Gemini. Rides existing `isLocalOnlySensitivity` machinery.
2. **Fail-CLOSED.** `loop_internal` on local-unavailable **throws and aborts** (infra-class failure), never falls back to cloud. Unit-tested: no reachable cloud branch.
3. **Redact-at-write** at the single sensor chokepoint (`redactLoopPayload`, REJECT-mode): only structured metadata; reuse sentry-scrub email regex; reject cuid; salted-HMAC pseudonyms; never message/prompt/response text, raw studentId, or email. Presidio-style **local NER sidecar** + VQ-specific regex (off-the-shelf NER leaks org names ~26% / custom IDs ~80%); reverse-map in process memory only, never disk.
4. **Cohort-of-one defense.** With one alpha classroom, name-stripping is insufficient (PTAC reasonable-person standard; implicit-identity ~43% leak). `loop_cluster.kAnonOk` small-cell suppression; **`recordLoopEvent` gates the write on `kAnonOk`** so cohort-of-one rows **never persist**.
5. **The real backstop:** mandatory CI `redact.test.ts` (+ fuzzed PII-in-error cases) asserting no email/cuid/raw-text reaches `loop_event` — **necessary because FORCE RLS = 0** (prismaAdmin always bypasses). Proven correct in P0 **before any brain reads `loop_event`.**
6. **Irreducible act-layer seam (standing risk-register item):** the cloud-hosted claude CLI means a single redaction defect in the **ACT** path (source comments, seed fixtures, Sentry frames, the diff) leaks PII with **no FORCE-RLS backstop**. Mitigation: a second mandatory CI **`act-redact.test.ts`** scanning every artifact crossing to cloud + a single runtime **egress chokepoint** (`src/lib/loop/egress-guard.ts`) that scans before egress and fails closed. **Open decision (OD-5):** invest in a local-only act layer to retire the seam.

**Secrets:** never print secret VALUES — env names/paths only; run-loop-* hooks include a PreToolUse known-secret/PII tripwire.

---

## 9. Recursive-Improvement Mechanism, Metrics & the Pre-Registered Success Contract (the proof)

### 9.1 — Pre-registered, time-bound success criteria (closes HIGH gap)
"Failure rate drops over time" is made **falsifiable** by committing — **before P1 begins, written into `loop_ledger` config as immutable `preRegisteredTarget` rows** — to concrete numbers and dates tied to the **90-day window ending 2026-06-21**:

| Pre-registered target | Metric | Commitment | Horizon |
|---|---|---|---|
| **PR-1 (meta-loop, offline, no prod risk)** | second derivative of diagnose/triage accuracy on the **frozen growing corpus** under Promptbreeder evolution | **strictly positive** (each generation improves over the last on held-out cases) across **≥3 generations** | demonstrable by **end of P1**, before any code auto-merge |
| **PR-2 (fix-loop, first targeted class)** | held-out post-deploy rate of the **first** targeted failure class | **drops ≥30% relative** vs the pre-fix baseline | within **the first 5 successful auto-deploys** of that class, **AND** the difficulty-calibration slice ceiling held |
| **PR-3 (corpus-loop)** | held-out `eval_case` count **and** difficulty-slice pass-rate | count grows monotonically; difficulty-slice pass-rate **stays ≤ ceiling** | continuously from P1 |
| **PR-4 (governance)** | rollback + recurrence rate | **non-increasing** generation-over-generation | continuously from P3 |

**Falsification:** if PR-1 is not demonstrable by end of P1 on the offline corpus (zero prod risk), **the recursion thesis has failed and P2/P3 do not proceed** — the loop is downgraded to a propose-only assistant. Because real student traffic does not exist until the 11-classroom rollout, **PR-2/PR-4 are pre-registered now but evaluated only once real signal exists**; the honest position is that **the offline meta-loop (PR-1) is the only target falsifiable inside the 2026-06-21 window**, and PR-1 is therefore the gate on continuing.

**Synthetic production canary rehearsal (closes Medium gap, PM review — the controller must be proven before live students):** because P3 stays OFF until real student traffic exists, the canary → multi-burn-rate → auto-rollback controller would otherwise be unexercised at first contact with real signal. P3 setup therefore includes a **dress rehearsal in prod (or the OD-4 2nd Render service)**: deploy a deliberately-known-GOOD and a deliberately-known-BAD synthetic change through the full ring/SLO/auto-rollback path and **assert the bad one auto-reverts and pins the prior commit** — *before* any student-traffic-driven fix is permitted to deploy. The rehearsal result is recorded in `loop_ledger`.

### 9.2 — The four nested loops
Proof artifacts live in `loop_ledger` + `eval_case` (see §2 table). Fix loop = `outerMetricDelta`; corpus loop = monotone held-out count + difficulty ceiling; meta loop = per-class 2nd derivative over `generation`; governance loop = rollback/recurrence rate.

### 9.3 — Probe / eval-case authoring mechanism — the anti-gaming keystone (closes CRITICAL gap)
The independent probe is the keystone of the entire anti-reward-hacking argument; it must be **structurally independent**, not merely asserted independent. Specification:
- **Separate probe-author identity & code.** Probes and held-out `eval_case`s are authored by a **distinct agent (`probe-author`) with its own prompt, its own model invocation, and ZERO shared code modules with the fixer or the judge.** `eval_case.authoredBy` records provenance. A **CI separation test** statically asserts: the probe-author module imports nothing from the fixer/judge modules and vice-versa (import-graph allowlist); the meta-check (§6 #12) fails any loop PR that touches the probe-author path.
- **Fixer-unreachable storage.** Probes/held-out cases live on the **CODEOWNERS-protected `eval_case` path**; the fixer never sees `heldOut=true` rows (enforced by query scoping + a CI test that the act runner's data access excludes held-out rows).
- **PII-free by construction.** Probe minting runs through the **same `redactLoopPayload` REJECT-mode chokepoint** and a redaction pass; minted rows enter **PENDING**; a **human PENDING→APPROVED gate** is required before a probe becomes `heldOut`/replayable. Probes are **synthetic scenarios or replayed seeded faults**, never raw transcripts.
- **Representativeness validation.** Each probe carries a `representativenessScore` — at minting, the probe-author must map the probe to the `incidentKey`/`rootCauseKey` it represents and to the failure-class distribution; a probe that does not cover a real observed root-cause is rejected at the human gate. The difficulty-calibration slice (PR-3) guards against trivial probes.
- **Independence assertion (written contract):** the plan asserts, and CI enforces, that **no code module is shared among {fixer, judge, probe-author}**, and that the probe-author runs under a **different actor identity** than the fixer. This is what makes "independent probe" true rather than aspirational. If any of these three roles is later merged into shared code, the separation CI check fails the build.

### 9.4 — VQ-specific yield calibration (closes unverified-claim gap)
The ~10-25% literature yield is an **unvalidated prior on VQ's bespoke 6-class taxonomy**. P2 runs a calibration: replay the labeled ledger backlog through the full act+gate pipeline **with human merge**, measure **actual** per-class signal→merged-fix yield and gate-rejection rate on VQ-shaped failures. **Auto-merge does not enable until this VQ-measured yield + an engaged (non-rubber-stamp) human-merge sample exists.** The literature number is replaced by the VQ-measured number in all capacity/cost planning (§11).

### 9.5 — Diagnose-quality calibration (closes unverified-claim gap)
The "gemma 8192/45s is sufficient" claim is an unvalidated prior. P1 benchmarks **local-model diagnosis quality on VQ-shaped failures** vs human root-cause labels on the ledger backlog; the **confidence gate threshold is set from this benchmark**, not guessed. If local diagnosis cannot meet the gate on VQ failures, the diagnose layer **stays propose-only past P2** (OD-5 / local-act-layer investment becomes relevant).

### 9.6 — Reward-hacking tripwire & reporting
**Definition of failure:** inner-score-up (more PRs merged / higher self-reported confidence) + outer-metric-flat (held-out rate not dropping via the independent probe) → **global killswitch.** Reporting: extend `project-autopilot/run-weekly-review` to publish per-class second-derivative trend + a **human-reviewed periodic convergence audit** (is the all-class failure rate trending down, **net of loop-induced events**). The red-team's irreducible residual (self-referential sensing → low-amplitude limit cycle) means **a human trend review remains mandatory; "gates are the human" does not fully hold for oscillation.**

---

## 10. Operability & Single-Maintainer Load (first-class design constraint, closes missing section)

For a one-PM solo operator (Britt), maintainability is a design constraint, not a footnote. The harness is already hard-down, which is itself evidence of neglect risk.

- **Maintenance budget (target):** the running loop must demand **≤ ~2 hours/week** of human attention in steady state — the weekly convergence audit + PENDING `eval_case` approvals + reviewing any escalated `maxAttemptsExceeded` clusters. If steady-state load exceeds this, autonomy rings are demoted until it fits.
- **On-call = nobody; therefore fail-safe, not fail-operational.** There is no on-call rotation. Every safety primitive is **fail-closed**: missing watcher heartbeat → killswitch; local Ollama down → diagnose aborts (no cloud fallback); spend cap hit → loop pauses; ground-truth drift → loop PRs blocked.
- **Graceful degradation on neglect (auto-pause):** a **neglect timer** — if no human has approved a PENDING `eval_case` or acknowledged the weekly audit within `config.neglect_pause_days` (default 14), the loop **auto-demotes to propose-only** (keeps sensing + diagnosing + filing PRs, stops auto-merge/auto-deploy). This directly answers "what runs if Britt is away 2 weeks": **sensing/diagnosis continue read-only; nothing auto-ships.**
- **Away-for-2-weeks scenario, concretely:** P0/P1 layers (read-only) keep running and accumulating signal/corpus (zero risk). P3 auto-deploy auto-pauses after `neglect_pause_days`. The interim/global killswitch + `loopEnabled=false` are one DB flip from a phone. Nothing requires human presence to stay safe.
- **Single off-switch (restated from §7.B):** `feature_flag.loopEnabled=false` + stop Task Scheduler = whole loop off; documented, tested, one command.
- **Operational surface minimization:** reuse `project-autopilot` runners/Task Scheduler/config.json rather than new infra; the watcher is the only genuinely-new always-on process and it is fail-closed.

---

## 11. Cost / Compute / Capacity Budget (closes missing section)

Solo-budget project on **Render Starter** + off-box local Ollama. Concrete budget and circuit-breaker (numbers are planning estimates, replaced by P2-measured VQ yield per §9.4):

- **Render Starter headroom:** the single Starter web service runs the Next.js app only. **Ollama, the watcher, the act runner, and worktrees do NOT run on the Render box** — they run on Britt's local/autopilot machine (where Ollama + Cloudflare Tunnel already live) and/or a 2nd cheap service for the watcher (OD-4). This keeps the prod web service's RAM/CPU headroom untouched by the loop; the loop's only prod footprint is **append-only DB writes + a deploy-hook call**.
- **Local compute (already owned):** Ollama + gemma runs on existing hardware (`warm-sage-model.ps1`); diagnosis is local and **$0 marginal cloud cost.** This is the FERPA design *and* the cost design.
- **Cloud spend (the only real $):** the **act layer** (cloud claude CLI on redacted bundles) is the sole metered cost. Estimate per act attempt: localize+repair+N-candidate generation + independent-test authoring ≈ a few dollars of tokens; at a daily cap of `max_act_calls_per_day` (default **5**) → bounded low-single-digit-dollars/day worst case.
- **CI minutes (the second cost):** mutation testing + coverage + promptfoo + e2e + sage-rag-strict per loop PR is heavy. **Mitigations:** (i) run the **full** heavy suite only on loop-labeled PRs, not every push; (ii) **mutation testing sampled** (changed-files only, capped mutant count) rather than whole-repo; (iii) reduce self-consistency vote count under budget pressure (config-driven).
- **Hard global spend circuit-breaker:** `config.max_spend_cents_per_day` (default **$10/day ≈ $300/mo ceiling**) tracked via `loop_ledger.spendCentsThisAttempt`; **on breach the loop pauses** (no new diagnose/act calls) until the next UTC day or manual reset. Checked at L3/L4 **entrance**, upstream of the deploy cap. Fallback under budget pressure: drop vote count, sample mutation testing, queue clusters instead of acting.
- **Watcher host decision (OD-4) is confirmed BEFORE P3,** not left open into autonomy: default recommendation = a 2nd minimal Render service or the autopilot box with deadman's-switch.

---

## 12. Build Plan P-1 → P3

> **Bootstrap reality (every phase):** NO live students until 11-classroom rollout → P-1…P2 run on **synthetic/replayed redacted traffic + seeded fault injection.** **Do NOT enable P3 until real student traffic generates genuine signal.**

### P-1 — Step Zero (prerequisites; all VERIFIED hard-down/missing). NO autonomy.
**Files/tasks:** **re-run the §0 ground-truth table on the then-current deploy branch and paste outputs into the P-1 PR (blocking);** add `scripts/verify-ground-truth.mjs` CI check. **Live-platform preflight (§0, blocking):** via Render API/dashboard confirm the service's **linked deploy branch** + current **`autoDeployTrigger`** + that **`ADMIN_DATABASE_URL` is set** (names/paths only, never values); via GitHub API confirm `main` protection/ruleset + auto-merge state. **Gate 0 setup:** set Render **`autoDeployTrigger: off`** (current field; `autoDeploy` is deprecated) + provision deploy-hook/`RENDER_*` (names only, `sync:false`); enable **GitHub branch-protection/ruleset on `main`** with required status checks (CI `verify` + loop gates) + **repo auto-merge** — currently `main` is UNPROTECTED + auto-merge OFF. Re-credential local claude CLI (rc=1 since 2026-05-08); restore Ollama/cloudflared/relay (`.state=UNHEALTHY`) via `warm-sage-model.ps1` + `start-sage-tunnel.bat`; run `codegraph init`; wire `logLlmCall` into provider stream paths (repairs token cap); add scrubbed `export const onRequestError = Sentry.captureRequestError` to `instrumentation.ts`; define server-side Sentry `beforeSend` scrub config (CODEOWNERS-protected + test); replace broken project-autopilot PostToolUse hook + add PreToolUse secret/PII redact gate + Stop parity check; **runtime-verify `ADMIN_DATABASE_URL` (postgres role) is set on the service (OD-1 runtime preflight — operator-confirmed set; NOT a repo blocker, §0)**; create `feature_flag` table early enough that the **interim killswitch (§7.A)** exists before any sensor write.
**Gates / success:** §0 table re-verified on deploy branch (any drift → STOP); **live-platform preflight pasted into the P-1 PR (Render linked-branch + `autoDeployTrigger: off` + `ADMIN_DATABASE_URL` set; GitHub `main` protected with required checks + auto-merge enabled) — Gate 0a ENFORCED before any actor gets write capability**; all 4 local substrates LIVE (claude rc=0; Ollama HEALTHY; `LlmCallLog` rows populate `durationMs`/ttft with **no prompt/response text field**; Sentry receives a deliberately-thrown scrubbed route error); interim killswitch flips loop writes off; manual deploy fires **only** via deploy-hook after CI green; CI still green.

### P0 — Sensor + Ledger (read-only, FERPA-critical, FIRST)
**Files/tasks:** Prisma `loop_event` + `loop_cluster` + `loop_ledger` + `feature_flag` + `eval_case` + `loop_infra_snapshot` + dated **expand/contract** migration (Pattern K admin-only RLS from baseline) + pg_cron PII-free TTL purge; `src/lib/loop/sensor.ts` `recordLoopEvent()` (prismaAdmin chokepoint, **killswitch-checked**, **gated on `kAnonOk`**); `src/lib/loop/redact.ts` `redactLoopPayload()` (REJECT-mode + local NER sidecar; salt from secret-manager **name only**); `emitLoopEvent()` inside `logAiAuditEvent`; `/api/internal/loop-event` ingest (`Bearer CRON_SECRET`, killswitch-checked); `instrumentation-client.ts` web-vitals beacon; `run-loop-sensor.bat`; `scripts/restore-loop-flags.mjs` + first `loop_infra_snapshot`.
**Gates / success:** **`redact.test.ts` mandatory + fuzzed PII-in-error cases** (no email/cuid/raw-text reaches `loop_event`) — must pass **before any brain reads `loop_event`**; **serving-path `loop_`-import = 0** CI check; RLS-strict confirms `loop_event` admin-only; pseudonym salting + cohort-of-one suppression verified (rows **not persisted**); **OD-1: `ADMIN_DATABASE_URL` confirmed set on the service (runtime preflight, §0) — else admin writes fail**; **rehearse §7.B one-switch disable (flip `loopEnabled`, confirm zero loop writes, flip back);** parity check: emitted events == manifest rows.

### P1 — Detect + Diagnose (read-only / propose-only brain)
**Files/tasks:** `src/lib/loop/detect.ts` (generalize `generateAiSafetyReport`): normalize → two-tier dedup (exact + pgvector/HDBSCAN, **abstain when Ollama degraded or cohesion low**) → `incidentKey` correlation → **Poisson behind hard count floor** → vs-ledger dedup → deterministic class → **actor/branch self-exclusion**. `src/lib/loop/diagnose.ts`: **new `AiTask loop_diagnose` + `DataSensitivity loop_internal`** (hard local-only, no override, **fail-closed unit test**) + CodeGraph/git-log/schema tools + vote-based confidence + abstain + causal-link + `rootCauseKey`. AI-quality detectors on redacted transcripts. `.claude/commands/loop-detect.md` + `agents/classifier.md` + `diagnostician.md` + **`agents/probe-author.md` (separate identity, §9.3)**. `/api/cron/loop-detect` + `loop-diagnose` (pg_cron `net.http_post` + `CRON_SECRET`). **FIRST recursive win:** offline Promptbreeder evolution against frozen growing corpus.
**Gates / success:** **PR-1 pre-registered target demonstrable (§9.1) — strictly-positive meta-loop 2nd derivative ≥3 generations on the offline corpus; if not, recursion thesis failed → STOP, downgrade to propose-only;** §9.5 diagnose-quality calibration sets the confidence gate from VQ benchmark; **confirm `loop_diagnose` can NEVER reach Gemini even with `ai_provider='cloud'`** (FERPA assertion + fail-closed test); probe-author import-separation CI check passes; k-anon verified; confidence = vote-agreement, never verbalized; synthetic/replayed signal only.

### P2 — Act (PR + auto-merge behind full CI; HUMAN-merge first to calibrate)
**Files/tasks:** `run-loop-act.bat` + `loop-act.md` (`claude -p` + git worktree, Agentless; `Edit`/`Bash` on parent only). **Independent hidden reproduction-test author step** + mutation testing + changed-line-coverage gate. Wire existing gates into CI (`sage-rag-harness --strict`; `test:e2e`+`test:smoke:api`; **promptfoo** local-Ollama judge; coverage). Move gate/eval/threshold/killswitch/**probe-author** files into CODEOWNERS-protected path + **meta-check CI step** (required status, allowlist + hash manifest) + **probe-author separation check (§9.3)**. `egress-guard.ts` + `act-redact.test.ts`. **Observability-regression gate.** Install promptfoo/stryker/coverage **CI-only (pinned), NOT in Render `dependencies`** (avoids prod-install bloat). Surgically open deny-list: **`gh pr create` only.**
**Gates / success:** **auto-merge stays OFF until §9.4 VQ-measured yield + an engaged (non-rubber-stamp) human-merge sample exists** (calibration fails closed on rubber-stamping); every PR through full CI + new gates; **AI-quality gate = paired statistics**, bias-audit fails CLOSED >10%; fixer provably never sees the gating test (CI-asserted held-out exclusion); changed-line coverage ~1.0 + mutants killed; promptfoo judge local (FERPA); meta-check + probe-separation fail build on violation; **CI-minute/spend within §11 caps.**

### P3 — Deploy + Safety Spine + Learn (full autonomy; {code,tool,skill,index} only — §7.D)
**Files/tasks:** Render **`autoDeployTrigger: off`** (from P-1 Gate 0); deploy via deploy-hook **only after CI green**. **Synthetic production canary rehearsal FIRST (§9.1):** prove the ring → burn-rate → auto-rollback controller with known-good + known-bad synthetic deploys (on prod or the OD-4 2nd service) before any student-traffic fix deploys. Wire `featureFlag` into `withRegistry` against DB-backed `feature_flag` **with in-process cache** (rings) + `/api/health/deep` (covers non-tool paths). External multi-window multi-burn-rate watcher **off the single box, with heartbeat + deadman's-switch**, outside loop write-reach → fast-path flag-to-0% + slow-path Render Rollback API (**pin bad commit**). **Post-deploy verify-or-auto-revert** on held-out + **independent probe (§9.3)** + sibling-class regression + statistical-power floor. `loop_ledger` second-derivative trend reporting. **Auto-convert confirmed prod failure → PENDING held-out `eval_case`** (via probe-author, §9.3). Surgically extend deny-list: **bounded `git push loop/*` + merge of loop-labeled PRs only.** `config.json`: `max_deploys_per_day`, `circuit_breaker_window`, `canary_thresholds{min_events,min_bake_time}`, `killswitch_file`, `max_spend_cents_per_day`, `neglect_pause_days`, all caps. **Single-writer deploy-lease.** **§7.B snapshot-restore tested.** Reconcile the 30-min Task Scheduler kill via **async dispatch+poll, NOT blocking run.** **OD-4 watcher host confirmed before this phase (§11).**
**Gates / success:** promote a ring **only** after rollback rates stay low (rising → auto-pause + demote, **hysteresis + dwell**); canary multi-burn-rate SLO; **post-deploy outer-metric-must-drop-or-revert via independent probe** (inner-up/outer-flat = reward-hacking → killswitch); killswitch checked before **every** merge AND deploy; per-day cap + circuit-breaker + spend cap; **schema-data/infra require human approval or proven expand/contract (§7.D, OD-6 signed off)**; **synthetic canary rehearsal passed (known-bad auto-reverted + prior commit pinned) BEFORE any student-traffic deploy (§9.1)**; **AI-quality (Sage) auto-merge enabled at P3 per OD-10 (§14.0) but ONLY with a MANDATORY standing sampled human audit that fails closed if judge↔human agreement drops** (audited autonomy, not propose-only); **neglect auto-pause armed (§10)**; **DO NOT enable until real student traffic exists** (so PR-2/PR-4 become evaluable).

---

## 13. How It Extends project-autopilot (does NOT build a parallel system)

- **Sensor:** `sage-health` (pure-shell, `.state`-diff dedup, writes `ALERT-*.md`) is the working Layer-1 prototype → clone `run-sage-health.bat` → `run-loop-sensor.bat`; UNHEALTHY signals POST into the same ingest.
- **Commands/agents:** add `.claude/commands/loop-detect.md` / `loop-act.md`; `agents/classifier.md`, `diagnostician.md`, **`probe-author.md`** modeled on existing `triager`/`risk-scout`.
- **Autonomy = surgically inverting the EXISTING deny-list under a SEPARATE controlled actor** — not loosening the read-only autopilot. Today `project-autopilot/.claude/settings.json` blocks `gh pr merge`, `git push`/`--force`, non-GET `gh api`, `rm -rf`. P2 opens **`gh pr create` only**; P3 opens **bounded `git push loop/*` + merge of loop-labeled PRs only**; `force`/`reset --hard`/`rebase`/`rm -rf`/`gh api` writes stay **permanently denied** at every ring.
- **Knobs (`config.json`):** `confidence_gate`, `spike_p_value`, `min_event_count`, `post_actuation_blackout_window`, `threshold_freeze_window`, `ring_trip/reset_threshold`, `ring_dwell_time`, `max_deploys_per_day`, `max_diagnose/act_calls_per_day`, `max_concurrent_worktrees`, `circuit_breaker_window`, `canary_thresholds`, `killswitch_file`, **`max_spend_cents_per_day`**, **`neglect_pause_days`**.
- **Reporting:** extend `run-weekly-review` for the recursive-improvement trend + human convergence audit; `run-morning-digest` summarizes overnight loop activity for the human DRI (Britt).
- **Reliability:** replace the broken PostToolUse hook (P-1); reconcile the 30-min Task Scheduler kill via async dispatch+poll; the watcher is the only new always-on process and is fail-closed (§10).

---

## 14. Risks & Open Decisions (for Britt)

### 14.0 — Decisions LOCKED (PM sign-off — Britt, 2026-06-04)

All 10 open decisions were walked and resolved on 2026-06-04. **These are the binding calls and OVERRIDE the original per-OD analysis retained further below for context;** where a decision changed an earlier section, that section now points here.

| OD | LOCKED decision | Notes / implication |
|---|---|---|
| **OD-1** | **Runtime preflight; provision only if unset** | `ADMIN_DATABASE_URL` operator-confirmed already SET in Render env (`=postgres`; `sync:false` ⇒ invisible in `render.yaml`). Reclassified from "repo-absent hard blocker" to a **P-1 runtime preflight** on the live service. Corrects the §0 grep false-positive (PM finding). |
| **OD-2** | **Dedicated `loop_event` rows**, emitted from inside the existing `logAiAuditEvent` call site | Near-zero new call sites; full redact-at-write + k-anon + killswitch governance. |
| **OD-3** | **Separate ops schema** (e.g. `vq_loop`) with **NO `vq_app` grant** | Strongest structural FERPA boundary given `FORCE RLS = 0`. **Supersedes the §5 `visionquest`-schema default.** Accept extra migration/grant setup. |
| **OD-4** | **Deferred to P3; tentative = 2nd minimal Render service** (off-box, deadman's-switch) | Confirm firmly at P3 entry (§11). |
| **OD-5** | **Accept the cloud `claude` act seam with the double guard** (`act-redact.test.ts` + runtime `egress-guard.ts`, fail-closed; redacted bundles only) | Residual = a redaction defect; ~zero now (no live students) but **must be proven before the 11-classroom rollout**. |
| **OD-6** | **SIGNED OFF:** autonomous = `{code, tool, skill, index}`; `{schema_data, infra}` human-gated | Explicit, knowing deviation from the locked "whole-app autonomous day 1" decision (`migrate deploy` is forward-only/irreversible). Satisfies the §7.D sign-off requirement. |
| **OD-7** | **Real-ledger replay + per-class seeded faults + a numeric precision/recall acceptance bar** | Synthetic confidence validates pipeline MECHANICS only; **P3 still gated on real student traffic** regardless. |
| **OD-8** | **Yes — WARN-level `audit:api-auth` BLOCKS loop-authored PRs** | Fail-closed on auth footguns over TANF/SNAP PII; accept minor false-positive friction. |
| **OD-9** | **All three:** separate machine identity + branch glob (`loop/*`) + PR-label gate | Defense in depth; `force`/`reset`/`rebase`/`rm -rf`/`gh api` writes stay permanently denied. |
| **OD-10** | **Audited autonomy from P3:** AI-quality (Sage) class MAY auto-merge at P3 **contingent on a MANDATORY standing sampled human audit that fails closed if judge↔human agreement drops** | PM override of the conservative propose-only lean. Implication: trusts the weakest gate (judge ~40% position-flip) sooner — the standing audit + fail-closed trip is the now-**mandatory** compensating control. |

### 14.1 — PM review findings incorporated (Britt, 2026-06-04)

| Finding | Severity | Resolution in this revision (rev2) |
|---|---|---|
| Plan inferred Render deploy truth from `render.yaml` alone | High | §0 + §6 Gate 0a + P-1 now require a **Render API/dashboard preflight** (linked branch, `autoDeployTrigger`, env presence); the `render.yaml` grep is downgraded to a repo-hint. |
| Use `autoDeployTrigger: off`, not deprecated `autoDeploy: false` | High | Replaced everywhere (§1, §4, §6, §12). |
| GitHub gates not enforceable yet (`main` unprotected, auto-merge off) | High | New **Gate 0a** (§6) + P-1 task: branch-protection/ruleset with required status checks + repo auto-merge, **ENFORCED before any actor write capability**. |
| `ADMIN_DATABASE_URL` overstated as repo-absent hard blocker | High | Reclassified to a **runtime preflight** (operator-confirmed set; `sync:false` ⇒ invisible in blueprint) across §0, §3, §12, OD-1. |
| Gate tooling in `dependencies` bloats prod | Medium | Moved to **CI-only pinned installs** (§0, §3, §4, §12). |
| Canary/rollback controller untested before live rollout | Medium | Added **synthetic production canary rehearsal** (§9.1, P3) before any student-traffic deploy. |
| Schema/infra carve-out vs locked decision | Medium | **Signed off** (OD-6, §7.D, §14.0). |

**Top residual risks (irreducible):**
1. **Statistical blindness at alpha scale** — every gate is set by guesswork against synthetic signal until rollout; may look convergent on replay and oscillate on first real traffic. **→ P3 OFF until real traffic; PR-2/PR-4 evaluated only then.**
2. **The cloud-claude act-layer seam** — a single redaction defect in the ACT path leaks PII with no FORCE-RLS backstop (mitigated by `act-redact.test.ts` + `egress-guard.ts`; OD-5 to retire).
3. **Local Ollama SPOF** for all FERPA-safe sensing/diagnosis (currently UNHEALTHY); gemma 8192/45s may underperform literature → **§9.5 calibration gates the confidence threshold; fail = propose-only.**
4. **AI-quality is the least-trustworthy gate** (judge position-flip ~40% on close pairs) yet most central to a coaching product → **autonomy granted LAST AND contingent on a standing sampled human audit with a documented minimum sample, failing closed if audit agreement drops (OD-10)**; otherwise AI-quality class stays propose-only past P3 until judge calibration ≥ target is empirically demonstrated on VQ traffic.
5. **Self-referential sensing limit cycle** — low-amplitude A→B→A drift can persist below per-window tripwires → **human-reviewed periodic convergence audit mandatory; "gates are the human" does not fully hold for oscillation.**
6. **Solo-maintainer neglect** — 5 layers + watcher + flag store + eval suites risk becoming unmaintained (harness is already hard-down) → **§10 neglect auto-pause + fail-closed defaults + ≤2hr/week budget.**

**Open decisions (decide at the gate, not mid-build):**
- **OD-1 (P-1/P0) [RESOLVED → §14.0; reclassified to RUNTIME PREFLIGHT]:** `ADMIN_DATABASE_URL` is operator-confirmed **set in Render env** (`sync:false` ⇒ invisible in `render.yaml`, which caused the earlier "absent" false-positive). Confirm on the live service at P-1; if ever unset, `prismaAdmin` falls back to `vq_app` and admin-only `loop_*` writes FAIL.
- **OD-2 (P0):** AI-class signals — reuse content-free `AuditLog` (+indexes) or fully route through `loop_event`?
- **OD-3 (P0/P3):** Where do `loop_*` tables live — `visionquest` schema (chosen) vs a separate loop/ops schema `vq_app` can't read (stronger structural FERPA boundary) vs local NDJSON (FERPA-trivial but can't be a GitHub Action)?
- **OD-4 (confirm BEFORE P3, §11):** burn-rate watcher host — 2nd Render service (recommended), self-hosted runner, or autopilot box? Budget for a Preview Environment / 2nd service?
- **OD-5 (cross-cutting):** accept the cloud-claude act seam (redacted-bundle guard + risk-register) or invest in a **local-only act layer** (lower yield) to eliminate it?
- **OD-6 (P3) [DECISION-CONFLICT, §7.D]:** **explicitly sign off** that "whole-app autonomous from day 1" is **knowingly narrowed** to `{code, tool, skill, index}` with `{schema_data, infra}` human-gated (rationale: `migrate deploy` is forward-only/irreversible) — or fund tested-reversible-migration tooling.
- **OD-7 (P0):** how much fault-injection fidelity is "enough" to trust the gates before real signal exists?
- **OD-8 (P2):** promote WARN-level `audit:api-auth` findings to merge-blocking for autonomously-authored PRs?
- **OD-9 (P3):** exact bounded-write allowlist form — branch glob (`loop/*`), PR-label gate, or separate machine identity (recommend: all three)?
- **OD-10 (P3) [AI-quality autonomy]:** make AI-quality-class auto-merge contingent on a **standing sampled human audit (documented minimum sample, fail-closed on dropping agreement)** — or keep AI-quality class **propose-only past P3** until judge calibration ≥ target is demonstrated on VQ traffic?

---

## 15. Research Basis (citations)

**Reference architecture & coding-agent reality**
- LangChain — How My Agents Self-Heal in Production (1:1 blueprint for L1/L2/L5): https://www.langchain.com/blog/production-agents-self-heal
- Agentless: Demystifying LLM-based SWE Agents (auditable localize→repair→validate, ~50.8%): https://arxiv.org/abs/2407.01489
- SWE-Cycle: full-cycle ≤13.5% (the honest ~10-25% yield prior, calibrated in §9.4): https://arxiv.org/html/2605.13139v1
- Beyond Resolution Rates: explore-before-edit +0.68 / premature-patch -0.78: https://arxiv.org/html/2604.02547v1
- Claude Code — Run parallel sessions with worktrees: https://code.claude.com/docs/en/worktrees

**Self-improvement & recursion**
- Darwin Gödel Machine (proven engine 20→50% AND the canonical verifier-gaming incident): https://arxiv.org/abs/2505.22954
- AlphaEvolve (evolutionary code search grounded in trusted evaluators): https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/
- Promptbreeder (safe self-reference at the prompt layer — the first recursive win; extrapolation to VQ diagnosis is validated by PR-1 in §9.1): https://arxiv.org/abs/2309.16797
- Mind the Gap: generation-verification gap grows with scale (never self-judge a fix): https://arxiv.org/abs/2412.02674
- AI-Native Companies: Building Self-Improving Organizations (Blomfield 5-layer; his L4 keeps human review): https://www.startuphub.ai/ai-news/artificial-intelligence/2026/ai-native-companies-building-self-improving-organizations

**Reward-hacking / overfitting / judges**
- Natural Emergent Misalignment from Reward Hacking in Production RL (Anthropic; inoculation prompting): https://arxiv.org/abs/2511.18397
- Test Overfitting by LLMs in APR (21.8-33% wrong; hidden repro tests → 5.8-11.3%): https://arxiv.org/html/2511.16858v1
- SWE-ABS: ~20% false-green on strengthened tests: https://arxiv.org/pdf/2603.00520
- Judging the Judges: position bias ~40% on close pairs: https://arxiv.org/abs/2406.07791
- When +1% Is Not Enough: paired BCa-bootstrap protocol (the statistical merge gate): https://arxiv.org/abs/2511.19794

**Deploy safety / SLO / canary**
- Google SRE Workbook — Alerting on SLOs (multi-window multi-burn-rate 14.4×/1h, 6×/6h, 1×/3d): https://sre.google/workbook/alerting-on-slos/
- Render Docs — Rollbacks (no native canary; rollback doesn't reverse migrations or disable auto-deploy): https://render.com/docs/rollbacks
- Render — How Render handles deploy failures (free first-line health-gated rollback): https://render.com/articles/how-render-handles-deploy-failures
- Argo Rollouts — Analysis (canary analysis logic to port): https://argo-rollouts.readthedocs.io/en/stable/features/analysis/
- Unleash — Kill switches vs progressive delivery: https://www.getunleash.io/blog/kill-switch-vs-progressive-delivery
- GrowthBook — Feature Flag Rules (local eval, no PII egress, safe-rollout): https://docs.growthbook.io/features/rules

**Detect / diagnose / FERPA**
- Sentry — Seer GA (RCA 94.5% / fix 53.6% — gates, not LLM, are the merge authority): https://blog.sentry.io/seer-sentrys-ai-debugger-is-generally-available/
- logpai/Drain3 (PII-masking-at-write log template mining): https://github.com/logpai/Drain3/blob/master/README.md
- GPTrace: crash dedup via LLM embeddings + HDBSCAN: https://arxiv.org/pdf/2512.01609
- AutoCrashFL (telemetry-only localization + repeated-run voting = calibrated confidence): https://arxiv.org/html/2510.22530
- LLM-Redactor (local-route+redact+rephrase = 0 exact leaks; NER leaks org ~26%/IDs ~80%/implicit ~43%): https://arxiv.org/html/2604.12064v1
- US Dept of Ed PTAC — Data De-identification (reasonable-person standard, small-cell suppression): https://studentprivacy.ed.gov/sites/default/files/resource_document/file/data_deidentification_terms_0.pdf
- Microsoft Presidio (local PII engine + custom recognizers): https://microsoft.github.io/presidio/
- promptfoo — CI/CD + Ollama provider (FERPA-safe local-judge AI-quality gate): https://www.promptfoo.dev/docs/integrations/ci-cd/

**Safety governance**
- AI-Augmented CI/CD Pipelines (policy-as-code, trust-tier staged autonomy): https://arxiv.org/abs/2508.11867
- Trustworthy AI Agents: Kill Switches and Circuit Breakers (external agent-inaccessible killswitch, token-bucket): https://www.sakurasky.com/blog/missing-primitives-for-trustworthy-ai-part-6/
- Specification Self-Correction (reduces spec-gaming >90%): https://arxiv.org/pdf/2507.18742

---

**Files this plan will create/modify (concrete VQ paths):** `prisma/migrations/<dated>_add_loop_tables/migration.sql` (expand/contract) · `src/lib/loop/{sensor,redact,detect,diagnose,egress-guard}.ts` · `src/lib/loop/redact.test.ts` · `src/lib/loop/act-redact.test.ts` · `src/lib/ai/types.ts` (+`loop_diagnose`,`loop_internal`) · `src/lib/ai/provider.ts` (`loop_internal` unconditional-local + fail-closed test) · `src/instrumentation.ts` (`onRequestError`) · `instrumentation-client.ts` · `src/lib/llm-usage.ts` (wire `logLlmCall`) · `src/lib/registry/index.ts` (`withRegistry` flag read + cache) · `src/lib/health.ts` → `/api/health/deep` · `src/app/api/internal/loop-event/route.ts` · `src/app/api/cron/{loop-detect,loop-diagnose}/route.ts` · `render.yaml` (`autoDeployTrigger: off` + deploy-hook; `ADMIN_DATABASE_URL` is a Render-env `sync:false` runtime preflight, not a blueprint edit) · `.github/workflows/ci.yml` (+repro/mutation/coverage, promptfoo, e2e/smoke, sage-rag --strict, meta-check, probe-separation, verify-ground-truth, serving-path-loop-import) · `.github/CODEOWNERS` + branch-protection ruleset · `scripts/{verify-ground-truth,restore-loop-flags}.mjs` · `project-autopilot/{run-loop-sensor.bat,run-loop-act.bat,.claude/commands/loop-detect.md,loop-act.md,agents/classifier.md,agents/diagnostician.md,agents/probe-author.md,.claude/settings.json (separate actor),config.json}` · `sentry.server.config.ts` (`beforeSend` scrub, CODEOWNERS-protected).
