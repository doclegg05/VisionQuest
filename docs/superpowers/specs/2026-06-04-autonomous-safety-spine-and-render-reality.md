# Autonomous Safety Spine and Render Deployment Reality

**Date:** 2026-06-04
**Status:** Evidence spec
**Scope:** VisionQuest self-improving loop P2/P3 safety gates, auto-merge preconditions, Render deployment reality

## Verdict

VisionQuest already has a strong CI spine for an alpha, but it is not yet an enforceable autonomous-merge spine. The current CI can become the load-bearing gate, but `main` is currently unprotected in GitHub, and the existing `project-autopilot` is deliberately read-only. P2/P3 should not flip directly from "agents propose, humans apply" to "agents merge and deploy" until repository protection, token boundaries, deploy rollback, and runtime evidence checks are explicit and machine-enforced.

Render supports zero-downtime deploys, health checks, service previews, preview environments, and rollbacks. Render does not provide a simple native progressive-canary switch for the current single-service `render.yaml`; true progressive canary has to be composed with feature flags or a blue/green traffic layer such as duplicated Render services plus Cloudflare-weighted routing.

## Evidence From This Repo

### CI is already the right base gate

`.github/workflows/ci.yml` runs on `push` and `pull_request` to `main`, with one `verify` job. The job already includes:

- strict RLS context flags (`RLS_CONTEXT_INJECTION=true`, `RLS_CONTEXT_STRICT=true`)
- lint
- static API auth wrapper audit
- typecheck
- unit tests
- hermetic Postgres migration plus RLS cross-tenant integration tests
- build
- Playwright-backed public/API smoke tests

Relevant local evidence:

- `.github/workflows/ci.yml:1` defines `CI`
- `.github/workflows/ci.yml:6` runs on pull requests to `main`
- `.github/workflows/ci.yml:40` enables strict RLS context
- `.github/workflows/ci.yml:59` through `.github/workflows/ci.yml:103` run lint, auth scan, typecheck, tests, RLS, build, and smoke

This is enough to be the primary pre-merge gate. The work is to make it required and add autonomy-specific checks, not to replace it.

### The gate is not enforced yet

Live GitHub check on 2026-06-04:

```powershell
gh api repos/doclegg05/VisionQuest/branches/main
```

returned:

```json
{
  "protected": false,
  "protection": {
    "enabled": false,
    "required_status_checks": {
      "enforcement_level": "off",
      "contexts": [],
      "checks": []
    }
  }
}
```

That is the immediate blocker for P2. Without branch protection or a ruleset, CI is advisory. An agent or human with push/merge rights can bypass it.

### Existing autopilot is intentionally read-only

The current `project-autopilot` posture is "propose, do not apply."

Relevant local evidence:

- `project-autopilot/.claude/settings.json:18` starts the deny list
- `project-autopilot/.claude/settings.json:27` denies `gh pr merge`
- `project-autopilot/.claude/settings.json:31` through `:33` deny non-GET GitHub API calls
- `project-autopilot/.claude/settings.json:35` through `:37` deny `git push`
- `project-autopilot/.claude/settings.json:38` denies `git reset --hard`
- `project-autopilot/README.md:98` starts the Safety section
- `project-autopilot/README.md:101` states all GitHub writes are read-only by default

P2 is therefore not a small permission change. It is an explicit inversion of the current safety model.

### Render is a single web service today

Current `render.yaml` defines one Render web service:

- `render.yaml:2` type `web`
- `render.yaml:3` name `visionquest`
- `render.yaml:5` plan `starter`
- `render.yaml:6` build command `npm ci && npx prisma generate && npm run build`
- `render.yaml:7` start command `npm run prisma:migrate:deploy && node .next/standalone/server.js`
- `render.yaml:8` health check path `/api/health`
- `render.yaml:26` keeps `SAGE_AGENT_ENABLED` present and disabled
- many secrets are `sync: false`, which means repo state alone cannot prove prod env state

The health endpoint is useful but basic:

- `src/app/api/health/route.ts:13` verifies DB connectivity with `SELECT 1`
- `src/app/api/health/route.ts:14` checks required tables
- `src/app/api/health/route.ts:19` returns unhealthy for missing tables
- `src/app/api/health/route.ts:33` returns healthy with `schema: "ready"`

For autonomous deploys, `/api/health` should be extended or paired with a separate deployment verification endpoint that reports commit SHA, schema state, RLS enforcement state, queue health, and critical dependency health without exposing secrets or PII.

### Runtime evidence is mandatory

The production readiness report already records the right lesson:

- `docs/plans/2026-05-29-production-readiness.md:6` records operator-run production RLS verification
- `docs/plans/2026-05-29-production-readiness.md:10` says env/infra state is not knowable from repo state when values are dashboard-managed

For self-improvement automation, this becomes a rule: the loop must verify GitHub, Render, Supabase, and runtime state through APIs before it changes permissions, merges, or rolls back.

## External Platform Facts

Render docs say auto-deploy can run "On Commit", "After CI Checks Pass", or "Off"; the "After CI Checks Pass" mode waits for repository CI checks and does not deploy if no checks are detected or if at least one check fails. Source: https://render.com/docs/deploys

Render deploys are zero-downtime unless a persistent disk is attached. For web/private services, the old instance keeps receiving traffic while the new instance starts, and Render shifts traffic after the new instance is healthy. Source: https://render.com/docs/deploys

Render rollbacks can be triggered through the dashboard or API. The API rollback does not disable automatic deploys, so an autonomous rollback path must also disable or pause auto-deploy if the bad commit remains on the linked branch. Source: https://render.com/docs/rollbacks

Render service previews create temporary standalone instances for a proposed web service/static site change. They do not replicate the whole environment. Source: https://render.com/docs/service-previews

Render preview environments can create copies of services and datastores for PRs, but require a Pro plan or higher. They do not copy existing data, and `sync: false` placeholder secrets are not copied to previews. Source: https://render.com/docs/preview-environments

Render's own blue/green canary example composes Render with Cloudflare traffic weights, Dash0 metrics, GitHub Actions, and SuperPlane. It duplicates services into blue/green environments; Render itself provides the hosting and zero-downtime building block, while traffic shaping is external. Source: https://render.com/blog/blue-green-deployments-on-render-with-canary-traffic-splitting

GitHub branch protection can require status checks, reviews, conversation resolution, merge queues, successful deployments, signed commits, and no bypass. Required status checks must pass before merging into a protected branch. Source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

GitHub auto-merge merges a PR only when required reviews and required status checks have passed, but it must be enabled for the repository and depends on branch rules being present. Source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request

## Safety Spine Contract

### P0 and P1: read-only loop

The loop may collect, classify, dedupe, diagnose, and draft PRs. It may not merge, push to `main`, trigger production deploys, or call Render rollback/deploy APIs.

Required properties:

- all event collection must redact at write time
- no student PII goes to cloud LLMs
- diagnosis over student-derived content uses local Ollama or redacted summaries
- every proposed action gets a durable ledger id
- every PR body references the ledger id, failure class, root cause, tests added/changed, risk level, and rollback plan

### P2: auto-merge gate

Before any agent receives merge capability, all conditions below must be true:

1. `main` is protected by a branch protection rule or ruleset.
2. Direct pushes to `main` are blocked for the agent token.
3. Required status checks include the exact GitHub check emitted by `.github/workflows/ci.yml` for the `verify` job.
4. Required status checks are strict, or a merge queue is enabled, so PRs are tested against current `main`.
5. Admin/bypass behavior is disabled for the automation path. If the owner keeps admin bypass for emergencies, the agent token must not have admin or bypass capability.
6. Repository auto-merge is enabled, but the agent may only enable auto-merge on PRs; it may not perform immediate merges.
7. The agent token has the minimum GitHub permissions needed: create branch, push its own branch, open PR, read checks, enable auto-merge. It must not be able to force-push, delete branches outside its namespace, edit branch protection, edit secrets, or administer the repository.
8. The PR includes a machine-readable autonomy manifest in the body.
9. A new autonomy check validates the manifest, changed-file policy, diff size, migration policy, and FERPA posture.
10. CI passes on the PR head and, if strict required checks are not used, on the merge commit candidate.

Recommended required check name:

```text
CI / verify
```

Confirm the exact emitted name in the GitHub UI before pinning it, because GitHub required checks are name-sensitive.

### Autonomy manifest

Each autonomous PR should include a fenced block like this:

```yaml
autonomy:
  ledger_id: loop_...
  failure_class: code | tool | skill | index | schema_data | infra | eval
  pii_exposure: none | redacted | blocked
  diagnosis_engine: local_ollama | deterministic | redacted_cloud
  change_risk: low | medium | high
  migration: none | expand_only | contract | destructive
  rollback:
    type: revert | render_rollback | feature_flag | traffic_shift
    verified_previous_deploy: true
  tests:
    unit: true
    rls: true
    smoke: true
    eval: true | false
```

The autonomy check fails if:

- `pii_exposure` is not `none` or `redacted`
- `diagnosis_engine` is `redacted_cloud` without proof that no student PII entered the prompt
- `migration` is `contract` or `destructive` without a separate expand/contract plan and rollback proof
- PR touches auth, RLS, Prisma schema, migrations, storage, AI safety, or deployment files without corresponding targeted tests
- no ledger id is present
- no rollback path is declared

### Changed-file policy

Low-risk autonomous merge can include app code, tests, docs, deterministic scripts, and prompt/eval files. Higher-risk files are still allowed under full autonomy, but they require extra automated gates:

- `prisma/schema.prisma` or `prisma/migrations/**`: migration deploy rehearsal, RLS integration suite, expand/contract compatibility check, and data rollback statement
- `src/lib/db.ts`, `src/lib/rls-*`, auth routes, session code, CSRF/proxy code: targeted auth/RLS tests and static auth audit
- `render.yaml`, `.github/workflows/**`, `project-autopilot/**`: infrastructure diff review by an autonomy-policy check and live state verification
- `src/lib/ai/**`, `src/lib/gemini.ts`, Sage prompt/extraction paths: AI safety/eval check with redacted fixtures

The point is not to require manual approval. The point is to require a stronger machine gate for higher blast radius.

## Render Deployment Options

### Option A: CI-gated Render deploy plus rollback API

Use Render's current single-service deploy path:

1. Protect `main`.
2. Configure Render Auto-Deploy as `After CI Checks Pass`, not `On Commit`.
3. Let GitHub auto-merge merge only when required checks pass.
4. Let Render deploy after checks pass.
5. Poll `/api/health` and synthetic routes after deploy.
6. If post-deploy verification fails, trigger Render rollback to the previous successful deploy.
7. Immediately disable/pause auto-deploy or create a reverting commit, because Render API rollback does not disable automatic deploys.

This is the fastest safe path, but it is not a progressive canary. It is all-at-once deploy with zero-downtime startup protection and post-deploy rollback.

### Option B: Feature-flag canary on one Render service

Deploy dormant code to the single production service, then progressively expose behavior through feature flags:

- internal/staff only
- 1-5% of eligible traffic
- 25%
- 50%
- 100%

Rollback is flag-off, which is faster than Render rollback. This works for product behavior, AI prompts, UI changes, workflow logic, and most self-improvement loop behavior. It does not protect against process startup failures, dependency incompatibility, broken migrations, or global infra config changes because those affect the whole service at deploy time.

This is the recommended near-term "canary" for VisionQuest.

### Option C: True blue/green canary

Create two Render service stacks, `blue` and `green`, backed by compatible database/schema rules, then route traffic with an external layer such as Cloudflare:

1. Detect current live color.
2. Deploy new commit to idle color.
3. Run health, smoke, RLS, and synthetic checks against idle color.
4. Shift 1-5% traffic through Cloudflare.
5. Watch Sentry, health, HTTP 5xx, auth failures, RLS/security alerts, and key user-flow metrics.
6. Promote in stages or restore weights to the old color.
7. Record deployment state in the loop ledger.

This is the closest match to "progressive canary + auto-rollback" but requires duplicated Render services, Cloudflare traffic management, metrics thresholds, and more cost/ops. It should be P3, not P0/P1.

### Option D: Render previews for pre-merge verification

Use Render service previews or preview environments to run smoke/eval checks against a deployed PR before merge.

Use cases:

- visual/manual inspection
- deployed smoke tests
- checking Render build/start behavior before merge

Constraints:

- service previews replicate only the service, not the full environment
- preview environments require Pro and create separate services/datastores
- preview environments do not copy existing data
- `sync: false` secrets are not automatically copied

Do not treat previews as production canaries. They are pre-prod evidence.

## Recommended Phasing

### Gate 0: make CI enforceable

Do this before P2:

1. Add branch protection or a ruleset for `main`.
2. Require PRs.
3. Require `CI / verify` or the exact emitted equivalent.
4. Require strict status checks or merge queue.
5. Disable force pushes and branch deletion.
6. Enable no-bypass for the automation path.
7. Enable repository auto-merge.
8. Verify with:

```powershell
gh api repos/doclegg05/VisionQuest/branches/main --jq '{protected, protection}'
gh api repos/doclegg05/VisionQuest/actions/permissions/workflow
```

The first command should no longer return `protected: false`.

### Gate 1: add autonomy checks

Add a workflow that runs on PRs and validates:

- autonomy manifest exists for agent-authored PRs
- ledger id exists and is unique
- no secrets or PII patterns were added
- changed-file risk class has required targeted tests
- schema changes are expand-only unless a contract plan exists
- Render/GitHub/autopilot files trigger live-state verification

Then add this workflow as a required status check.

### Gate 2: narrow write permissions

Do not simply remove the autopilot deny list. Add a separate write-capable profile or wrapper:

- branch names limited to `agent/loop-*`
- no direct `main` push
- no force push
- no branch protection edits
- no secret edits
- no Render deploy/rollback unless running inside the deploy controller
- GitHub writes logged to `loop_ledger`

The current read-only profile should remain available for analysis-only tasks.

### Gate 3: deployment controller

Implement a deploy controller that consumes merge/deploy events and records:

- PR number
- commit SHA
- Render service id
- previous successful deploy id
- new deploy id
- deploy started/healthy/promoted/rolled back timestamps
- health samples
- smoke results
- Sentry/error-rate samples
- rollback action if any

For Option A, the controller handles post-deploy verification and Render rollback. For Option B, it handles feature flag ramp and flag rollback. For Option C, it handles blue/green traffic weights.

## Deployment Failure Thresholds

Initial thresholds for automatic rollback:

- `/api/health` returns non-200 twice consecutively after deploy warmup
- schema is not `ready`
- auth login/register smoke fails
- public-route smoke fails
- API smoke fails
- RLS smoke or sentinel query fails closed/open unexpectedly
- Sentry new issue count exceeds baseline threshold for the release
- HTTP 5xx rate exceeds baseline by a configured multiplier for 5 minutes
- Sage critical path eval falls below the current accepted score
- any FERPA/PII redaction check fails

For alpha with no live students, thresholds can be strict. Before live cohort, tune thresholds from real baseline data.

## Open Decisions

1. Use GitHub branch protection or repository rulesets? Rulesets are cleaner long-term; branch protection is faster.
2. Use GitHub native auto-merge or a custom merge controller? Native auto-merge is safer because GitHub enforces required checks.
3. Near-term canary: feature flags or duplicated Render services plus Cloudflare?
4. Where does `loop_ledger` live: app Postgres, separate automation SQLite, or both?
5. Should Render auto-deploy be `After CI Checks Pass` or `Off` with deploy-controller-triggered API deploys?

## Recommendation

Use this path:

1. Gate 0 immediately: protect `main`, require CI, enable auto-merge, keep agent direct merge/push disabled.
2. Build P0 sensor + ledger and P1 diagnosis as read-only.
3. Add autonomy manifest and autonomy-check workflow.
4. Allow agents to open PRs and enable GitHub native auto-merge only after Gate 0 and Gate 1 pass.
5. Use Render `After CI Checks Pass` plus post-deploy verification and rollback API as the first deploy spine.
6. Use feature flags as the first practical canary.
7. Treat true blue/green canary as P3 infrastructure: duplicated Render services plus external traffic weights and metrics.

The safety spine is not "more human approval." It is converting Britt's approval posture into executable gates: branch protection, CI, FERPA redaction, live runtime verification, deploy ledger, and rollback automation.
