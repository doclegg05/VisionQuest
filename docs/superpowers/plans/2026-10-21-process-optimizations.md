# Process Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch every implementer and reviewer subagent with `model: "sonnet"`.

**Goal:** Cut the recurring costs in how VisionQuest is built and run: the oversized memory file, red scheduled workflows, a flaky eval gate, gotchas that live only as notes, branch clutter, and session sandbox blocks.

**Architecture:** Session history leaves `.claude/MEMORY.md` and goes into one new file per session under `.claude/handoffs/`. New files never conflict, and a validator in `pipelines:validate` keeps the memory file small. Gotchas become small scripts under `scripts/terminal/` and `scripts/git-hooks/`, each with a `node --test` suite run by one new CI step. The two red workflows need GitHub settings changes only, so they are owner steps rather than tasks.

**Tech Stack:** Node 24 ESM (`.mjs`, `node:test`), POSIX bash compatible with macOS bash 3.2, GitHub Actions, `gh` CLI.

**Spec:** The six-point process review given in chat on 2026-10-21, restated here. Facts checked that day:
- `origin/main:.claude/MEMORY.md` is 839 lines. It holds about 35 session sections, a 120-line Current Status, a 180-line decision log and 170 lines of open items. 106 of the 834 commits to `main` since 2026-08-01 touched it.
- Cron Health fails every night because the `CRON_CHECK_DATABASE_URL` secret is unset (`cron-health.yml` exits 2 by design).
- Benchmarks' suites pass. Only `commit-results` fails, with "Enable 'Allow GitHub Actions to create and approve pull requests'".
- `platform:validate` already runs in CI (`ci.yml:104`), so it is out of scope.
- The memory eval gates on one run: `computeMemoryEvalExitCode` in `scripts/sage-memory-eval.mjs` fails below a hit rate of 0.9. All 10 Sage Evals runs since #256 merged (2026-10-16) passed.
- The memory eval prints its privacy leak counts as "must be 0" but `computeMemoryEvalExitCode` ignores them, so a leak does not fail the run.
- Three files depend on memory-file section names: `.claude/commands/ci-pipeline.md:130` and `.claude/commands/a11y-pipeline.md:127` tell agents to edit Current Status, Last Session, Open Items and the Key Decisions Log. `scripts/validate-ci-pipeline-command.mjs:108` and `scripts/validate-a11y-pipeline-command.mjs:115` require those commands to mention `.claude/MEMORY.md`, "current status" and "last session". `AGENTS.md:65` holds a stale copy of the decision log's first rows.
- After moving history out, the open items (115 non-blank lines), known issues (72) and architecture notes (15) that stay add up to about 260 lines with headings and spacing.

## Global Constraints

- Work starts from a fresh branch `chore/process-optimizations` cut from `origin/main`. Never from `codex/Supabasedesign`, which has diverged.
- Use an isolated worktree (Agent `isolation: "worktree"`). It starts from this checkout's HEAD, so the first command inside it is `git switch --no-track -c chore/process-optimizations origin/main`. `--no-track` matters because the session sandbox blocks writes to `.git/config`. Before dispatching any task, probe once that a worktree can be created and written to. If the sandbox refuses, stop and ask Britt to create it in the Terminal panel; do not work in the main checkout.
- Never run `npm ci` or `npx prisma generate` inside the worktree, because that can corrupt the main checkout's Prisma client. CI on the PR is the full proof.
- Tests that create git repos set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` in the child environment. CI runners have no git identity, and `git commit` fails there without it.
- New scripts are `.mjs` (ESM) or bash that runs on macOS bash 3.2: no `mapfile`, no associative arrays, no `${var,,}`.
- Every new test runs under `npm run test:process-tools` (created in Task 1, extended by later tasks). Read its `# pass` / `# fail` summary.
- No script prints a secret value. Database URLs print as host only.
- Commit subjects follow `type: description` (`feat`, `fix`, `chore`, `docs`, `test`, `ci`). No attribution trailers.
- Prose you write (CLAUDE.md lines, handoff stubs, PR body) contains no em dashes. Moved content keeps its original text.
- Tasks 1 to 6 ship as one PR. Task 7 is on hold (see its precondition).
- Do not edit `scripts/validate-ci-pipeline-command.mjs` or `scripts/validate-a11y-pipeline-command.mjs`. They are CI-enforced graders. The command text must keep satisfying them.

## Review Focus

1. **A worktree that borrows the main checkout's `node_modules` switches branches.** The hook must not run `prisma generate`. It should print a warning instead (Task 4 test `skips generate without own node_modules`).
2. **The env runner's output and log.** They must never contain a password or token from `.env.local`, even when the DB host banner prints (Task 5 test `never prints secret values`).
3. **A branch tip moved after the manifest was written.** That branch is refused, the others still run, and the exit code is non-zero (Task 6 test `refuses moved tip and continues`).
4. **Several session headings share a date** (the file has three "Also 2026-10-16" sections). Each must get its own filename, and the split must lose no line (Task 1 tests `distinct filenames for same-date headings` and `findMissingLines is empty after split`).
5. **`git worktree add` and `git clone` call post-checkout with an all-zero old SHA.** `git diff` then errors, and the hook must not read that error as "schema changed" or fail the checkout (Task 4 test `null old sha is a no-op`).

---

### Task 1: Session-split lever

**Files:**
- Create: `scripts/memory/split-sessions.mjs`
- Test: `scripts/memory/split-sessions.test.mjs`
- Modify: `package.json` (add `test:process-tools`)
- Modify: `.github/workflows/ci.yml` (new step after "Ollama relay tests")

**Interfaces:**
- Produces: `splitSessions(markdown: string): { kept: string, handoffs: Array<{ filename: string, content: string }> }`
- Produces: `findMissingLines(original: string, outputs: string[]): string[]`. Returns each non-blank line of `original` that appears in none of `outputs`, compared after trimming. This is a set comparison: a line that occurs twice counts once. That is acceptable here because nearly every line carries a date or a unique fact.
- Produces: CLI `node scripts/memory/split-sessions.mjs <in.md> --out-dir <dir> [--write]`. Dry run by default: it prints the planned filenames and the line counts.

Rules the code must follow:
- A session section is a `## ` heading matching `/^## (Last Session|Prior Session|Also |Previous Session|Session Before That)/`, up to the next `## `.
- The filename is `YYYY-MM-DD-<slug>.md`. The date is the first `\d{4}-\d{2}-\d{2}` in the heading, or failing that in the first `**Date**:` line. The slug is the kebab-cased heading with the date and the words "prior/also/session" removed, at most 60 characters.
- With no date, use `undated-<n>-<slug>.md`. On a collision, add `-2`, `-3` and so on.
- Content is `# <heading text>` followed by the section body unchanged.

- [ ] **Step 1: Write the failing tests** in `split-sessions.test.mjs` (`node:test` + `node:assert/strict`), using one inline fixture with: a `## Project Overview`, two `## Also 2026-10-16 (x)` sections, one `## Previous Session` whose body has `- **Date**: 2026-07-31 (...)`, and a trailing `## Known Issues`.
  - `distinct filenames for same-date headings`: the two 2026-10-16 handoffs have different filenames, and both start with `2026-10-16-`.
  - `date falls back to the Date line`: the Previous Session handoff filename starts with `2026-07-31-`.
  - `non-session sections stay in order`: `kept` contains `## Project Overview` before `## Known Issues`, and no `## Also`.
  - `findMissingLines is empty after split`: `findMissingLines(fixture, [kept, ...handoffs.map(h => h.content)])` deep-equals `[]`.
  - `findMissingLines reports a dropped line`: with one handoff removed from outputs, the result includes that handoff's first body line.
- [ ] **Step 2: Add the npm script and confirm the tests fail.** Add `"test:process-tools": "node --test scripts/memory/*.test.mjs"` to `package.json`. Run `npm run test:process-tools`. Expected: fail, because the module is not found.
- [ ] **Step 3: Implement** both exports and the CLI in `split-sessions.mjs`. Use `node:fs` only.
- [ ] **Step 4: Run** `npm run test:process-tools`. Expected: `# fail 0`, `# pass 5`.
- [ ] **Step 5: Add the CI step** in `ci.yml` right after "Ollama relay tests": `- name: Process tooling tests` / `run: npm run test:process-tools`.
- [ ] **Step 6: Commit** `feat: add memory session-split lever with lossless check`.

### Task 2: Apply the split and guard the memory file

**Files:**
- Modify: `.claude/MEMORY.md`, `CLAUDE.md` (lines 12 and 60), `.claude/commands/ci-pipeline.md:130-136`, `.claude/commands/a11y-pipeline.md:127-133`, `AGENTS.md:65` onward (the stale decision log)
- Create: `.claude/handoffs/*.md` (generated), `.claude/handoffs/2026-10-21-status-archive.md`, `docs/decisions/engineering-log.md`, `docs/decisions/closed-items.md`
- Create: `scripts/memory/validate-memory-file.mjs`, `scripts/memory/validate-memory-file.test.mjs`
- Modify: `package.json` (`memory:validate`, extend `pipelines:validate`)

**Interfaces:**
- Consumes: `splitSessions`, `findMissingLines` (Task 1).
- Produces: `checkMemoryFile(text: string): string[]` (error messages; empty means valid). CLI `node scripts/memory/validate-memory-file.mjs [path]`, default `.claude/MEMORY.md`, exits 1 on any error.

Rules `checkMemoryFile` enforces:
- At most 300 lines. The kept sections measure about 260, so 200 would force cutting live facts. Pruning open items further is Britt's call, not the validator's.
- Headings present in this order: `## Project Overview`, `## Current Status`, `## Last Session`, `## Open Items`, `## History and Decisions`, `## Architecture Notes`, `## Known Issues`.
- No other session heading matching the Task 1 regex.
- `## Current Status` has at most 20 non-blank lines, and `## Last Session` at most 4.
- No `- [x]` lines and no `~~`.

- [ ] **Step 1: Write the failing tests** in `validate-memory-file.test.mjs`. Build a minimal valid fixture with the seven headings, then check:
  - `valid fixture has no errors`: the result is `[]`.
  - `over 300 lines fails`: fixture plus 300 filler lines gives an error containing `300`.
  - `prior session heading fails`: adding `## Prior Session (2026-01-01)` gives an error containing `session heading`.
  - `closed item fails`: adding `- [x] done` gives an error containing `closed item`.
  - `missing heading fails`: removing `## Known Issues` gives an error containing `Known Issues`.
- [ ] **Step 2: Confirm the tests fail.** The existing `scripts/memory/*.test.mjs` glob already picks up the new file. Run `npm run test:process-tools`. Expected: the new tests fail with module not found.
- [ ] **Step 3: Implement** `checkMemoryFile` and the CLI. Add `"memory:validate": "node scripts/memory/validate-memory-file.mjs"` and append ` && npm run memory:validate` to `pipelines:validate`. Run the tests. Expected: `# fail 0`.
- [ ] **Step 4: Save a copy of the original.** Run `git show origin/main:.claude/MEMORY.md > "$TMPDIR/memory-original.md"`.
- [ ] **Step 5: Generate the handoffs.** Run `node scripts/memory/split-sessions.mjs .claude/MEMORY.md --out-dir .claude/handoffs --write`. Expected: about 35 files in `.claude/handoffs/`.
- [ ] **Step 6: Carry over local-only history.** Read `/Users/brittlegg/MacDev/companies/education/VisionQuest/.claude/MEMORY.md`, the uncommitted working tree of the main checkout. For each session section or open item whose text is not in `$TMPDIR/memory-original.md`, write it as a handoff file or keep it as an open item. Read this file only; never edit it.
- [ ] **Step 7: Move the long sections out.**
  - Move `## Key Decisions Log` verbatim to `docs/decisions/engineering-log.md` under `# Engineering Decisions Log`, with one line saying new rows are appended there.
  - Move every `- [x]` item and its sub-bullets, plus every `~~` struck Known Issues entry, verbatim to `docs/decisions/closed-items.md`.
  - Move the old Current Status verbatim to `.claude/handoffs/2026-10-21-status-archive.md`.
- [ ] **Step 8: Rewrite the kept sections.**
  - Write a new `## Current Status` of at most 20 lines: what is live, what is blocked and on whom, and the open PRs.
  - Write `## Last Session` as `- **Date**: 2026-10-21` plus `- **Handoff**: .claude/handoffs/<newest file>`.
  - Add `## History and Decisions` with three pointer lines: handoffs folder, engineering log, closed items.
  - Leave Known Issues as it is apart from the struck entries. Tasks 3 and 4 add their own pointer lines there.
- [ ] **Step 9: Update the session-end rule everywhere it is written.**
  - In `CLAUDE.md` lines 12 and 60: at session end, write a new `.claude/handoffs/YYYY-MM-DD-<slug>.md` and repoint the `## Last Session` lines. Edit other MEMORY.md sections only when their facts change. Decisions are appended to `docs/decisions/engineering-log.md`.
  - In both pipeline commands' Ship step: same rule. The new text must still contain `.claude/MEMORY.md`, "Current Status" and "Last Session" so the frozen validators pass, and it must name `docs/decisions/engineering-log.md` where it used to say Key Decisions Log.
  - In `AGENTS.md`, replace the stale `## Key Decisions Log` table with one line pointing at `docs/decisions/engineering-log.md`. First confirm every row it holds is already in the moved log, and add any that are not.
- [ ] **Step 10: Check for lost lines.** Run a node one-liner that calls `findMissingLines(original, [MEMORY.md, every handoff, engineering-log, closed-items])`. Expected: an empty array, with no exceptions. The status archive holds the old Current Status verbatim.
- [ ] **Step 11: Check the code-comment pointers.** Run `git grep -n 'MEMORY.md' -- ':!*.md'`. For each comment naming a section (Open Items, Known Issues, a D-number, a dated entry), confirm the cited fact is still in the named section. If it moved, change the comment to name its new file. Expected: every pointer resolves.
- [ ] **Step 12: Run the checks.** `wc -l .claude/MEMORY.md` should print at most 300. `npm run memory:validate` should exit 0. `npm run pipelines:validate` should exit 0, which also proves both pipeline commands still pass their validators.
- [ ] **Step 13: Commit** `docs: split session history out of MEMORY.md into handoff files`.

### Task 3: Merge helper and clean typecheck

**Files:**
- Create: `scripts/terminal/merge-pr.sh`, `scripts/terminal/__tests__/merge-pr.test.mjs`
- Modify: `package.json` (`typecheck:clean`, extend `test:process-tools`)

**Interfaces:**
- Produces: `scripts/terminal/merge-pr.sh <pr-number> [squash|merge]` (default `squash`).
  - It runs `gh pr merge <n> --<method>` and ignores that command's exit code.
  - It then polls `gh pr view <n> --json state,mergeCommit --jq '.state + " " + (.mergeCommit.oid // "")'` up to 10 times, `MERGE_PR_POLL_SECONDS` apart (default 3).
  - On `MERGED`, it prints `MERGED <oid>` and exits 0. Otherwise it prints the last state and the gh merge output, then exits 1.
- Produces: `npm run typecheck:clean` = `node -e "require('fs').rmSync('tsconfig.tsbuildinfo',{force:true})" && tsc --noEmit`.

- [ ] **Step 1: Write the failing tests.** Each test puts a fake `gh` first on `PATH`, written to a temp dir. It is driven by `FAKE_GH_MERGE_EXIT` and `FAKE_GH_STATE`, with `MERGE_PR_POLL_SECONDS=0`.
  - `nonzero gh exit but MERGED state succeeds`: merge exit 1 and state `MERGED abc123` give exit 0, and stdout contains `MERGED abc123`.
  - `OPEN state fails`: merge exit 0 and state `OPEN ` give exit 1, and stdout contains `OPEN`.
  - `rejects non-numeric PR`: argument `abc` gives exit 2.
- [ ] **Step 2: Extend and run.** Extend `test:process-tools` with `scripts/terminal/__tests__/*.test.mjs`, then run it. Expected: the new tests fail.
- [ ] **Step 3: Implement** `merge-pr.sh` (`chmod +x`). Add `typecheck:clean` to `package.json`.
- [ ] **Step 4: Run.** `npm run test:process-tools` should report `# fail 0`.
- [ ] **Step 5: Commit** `feat: add merge helper that verifies merge state via the API`.

### Task 4: Post-checkout Prisma hook

**Files:**
- Create: `scripts/git-hooks/post-checkout`, `scripts/git-hooks/__tests__/post-checkout.test.mjs`
- Modify: `package.json` (extend `test:process-tools`)

**Interfaces:**
- Produces: a git `post-checkout` hook taking args `$1 old`, `$2 new`, `$3 flag`.
  - It exits 0 at once when `$3` is not `1` or when `$1` is all zeros (new worktree or clone).
  - It acts only when `git diff --quiet $1 $2 -- prisma/schema.prisma` exits exactly 1. Exit 128 (an error) is treated as no change.
  - If `$(git rev-parse --show-toplevel)/node_modules/.prisma` exists, it runs `npx prisma generate`.
  - Otherwise it prints `post-checkout: schema changed but this checkout has no own node_modules; run npm ci here before prisma generate` and exits 0.
  - It always exits 0, so a checkout never fails because of the hook.

- [ ] **Step 1: Write the failing tests.** Each test builds a temp git repo with two commits, where the second changes `prisma/schema.prisma`. A fake `npx` on `PATH` appends its arguments to a log file. The tests invoke the hook directly with the two commit SHAs and flag `1`.
  - `generates when schema changed and own node_modules`: with `node_modules/.prisma/` created, the npx log contains `prisma generate`.
  - `skips generate without own node_modules`: the npx log is empty, and stdout contains `no own node_modules`.
  - `no-op when schema unchanged`: running with the same SHA twice leaves the npx log empty.
  - `file checkout flag 0 is a no-op`: flag `0` leaves the npx log empty.
  - `null old sha is a no-op`: old SHA `0000000000000000000000000000000000000000` with flag `1` gives exit 0 and an empty npx log.
- [ ] **Step 2: Extend and run.** Extend `test:process-tools` with `scripts/git-hooks/__tests__/*.test.mjs`, then run it. Expected: the new tests fail.
- [ ] **Step 3: Implement** the hook (`chmod +x`).
- [ ] **Step 4: Run.** Expected: `# fail 0`.
- [ ] **Step 5: Point Known Issues at it.** In `.claude/MEMORY.md` Known Issues, add one sentence to the stale-Prisma-client entry: the hook in `scripts/git-hooks/post-checkout` handles this once owner step O6 is done. Also add one sentence to the merge-flow gotcha pointing at `scripts/terminal/merge-pr.sh` (Task 3).
- [ ] **Step 6: Commit** `feat: add post-checkout hook that regenerates Prisma client safely`.

### Task 5: Env runner for sandbox-blocked jobs

**Files:**
- Create: `scripts/terminal/run-with-env.mjs`, `scripts/terminal/__tests__/run-with-env.test.mjs`, `scripts/terminal/README.md`
- Modify: `.gitignore` (add `reports/terminal/`)

**Interfaces:**
- Produces: `node scripts/terminal/run-with-env.mjs [--yes] <npm-script> [args...]`.
  - It must run from the repo root, and it exits 2 with `.env.local not found` when that file is missing.
  - It loads the file with `process.loadEnvFile('.env.local')`, Node's dotenv-style parser. It does not source the file as shell, which would mangle values containing `$`, `&` or spaces and would execute the file's contents.
  - It prints `Target DB host: <host>`, parsed with `new URL(process.env.DATABASE_URL).hostname`, never showing credentials.
  - Without `--yes`, it waits for Enter.
  - It spawns `npm run <npm-script> -- <args>` with the loaded environment and copies the output to both the terminal and `reports/terminal/<UTC yyyymmddTHHMMSSZ>-<npm-script>.log`, then prints the log path. It exits with npm's exit code.
  - The npm script name must match `/^[a-z0-9:_-]+$/`; anything else exits 2.
- `README.md`: one table of the jobs the session sandbox blocks (live evals, DB scripts, `tsx` CLI) with the exact command for each, and one paragraph explaining that a session reads the printed log path afterwards.

- [ ] **Step 1: Write the failing tests.** Each test uses a temp dir as cwd with a `.env.local` holding `DATABASE_URL=postgresql://u:s3cret$pw@db.example.test:5432/x` and `OPENROUTER_API_KEY=sk-or-fake-value`. A fake `npm` on `PATH` echoes `KEY_SEEN=${OPENROUTER_API_KEY:+yes}` and `DB_LEN=${#DATABASE_URL}`.
  - `loads env for npm`: run with `--yes demo`, stdout contains `KEY_SEEN=yes`, and the exit code is 0.
  - `never prints secret values`: neither stdout nor the log file contains `s3cretpw` or `sk-or-fake-value`, and stdout contains `db.example.test`.
  - `writes a log under reports/terminal`: exactly one `*-demo.log` file exists.
  - `missing env file exits 2`: without `.env.local`, the exit code is 2 and stderr contains `.env.local not found`.
  - `dollar sign survives`: stdout contains `DB_LEN=` followed by the full length of the URL above, proving `$pw` was not expanded away.
  - `rejects unsafe script name`: argument `demo;rm` gives exit 2 and the fake npm never runs.
- [ ] **Step 2: Run.** `npm run test:process-tools` should show the new tests failing.
- [ ] **Step 3: Implement** the script, the README and the `.gitignore` line.
- [ ] **Step 4: Run.** Expected: `# fail 0`.
- [ ] **Step 5: Commit** `feat: add env runner for jobs the session sandbox blocks`.

### Task 6: Branch cleanup script and manifest

**Files:**
- Create: `scripts/terminal/branch-cleanup.sh`, `scripts/terminal/__tests__/branch-cleanup.test.mjs`, `docs/audits/2026-10-21-branch-cleanup-manifest.tsv`
- Add: `docs/audits/2026-10-19-unmerged-branch-review.md`, copied unchanged from the main checkout, where it is untracked. The manifest is built from it, so reviewers need it in the same PR.

**Interfaces:**
- Produces: `scripts/terminal/branch-cleanup.sh <manifest.tsv> [--apply] [--remote origin]`.
  - The manifest has one row per branch: `branch<TAB>sha<TAB>action`, with action `delete` or `archive`. Lines starting with `#` are comments.
  - A dry run (the default) prints `WOULD <action> <branch> @ <sha>` per row.
  - With `--apply`, `archive` first runs `git tag archive/<branch> <sha>` and `git push <remote> refs/tags/archive/<branch>` (fully qualified, so a branch with the same name cannot win), then deletes. `delete` runs `git push --force-with-lease=refs/heads/<branch>:<sha> <remote> :refs/heads/<branch>`.
  - A refused row prints `REFUSED <branch>` and the script moves on to the next row.
  - It exits 1 if any row was refused or failed, and 0 otherwise.

- [ ] **Step 1: Write the failing tests.** Each test uses a temp bare remote plus a clone with branches `a`, `b` and `c` pushed, and a manifest written per test.
  - `dry run changes nothing`: all three remote branches still exist afterwards.
  - `apply deletes and archives`: rows `a delete` and `b archive` leave `a` and `b` absent on the remote and tag `archive/b` present.
  - `refuses moved tip and continues`: `a` is listed with a stale sha and `c delete` with the right sha. Afterwards `a` still exists, `c` is gone, the exit code is 1, and stdout contains `REFUSED a`.
- [ ] **Step 2: Run.** Expected: the new tests fail.
- [ ] **Step 3: Implement** the script (`chmod +x`).
- [ ] **Step 4: Run.** Expected: `# fail 0`.
- [ ] **Step 5: Build the manifest.**
  - Read `/Users/brittlegg/MacDev/companies/education/VisionQuest/docs/audits/2026-10-19-unmerged-branch-review.md` (untracked in the main checkout) and the "Remaining GitHub branches (2026-10-19)" open item.
  - Write rows for the 15 closed-without-merge branches (`delete`) and for the branches the audit marks archive (`archive`) or delete (`delete`).
  - Leave out the four kept branches and the four "land" branches with open PRs #259, #262, #263 and #264.
  - Fill each sha from `git ls-remote origin refs/heads/<branch>`. Drop any branch that no longer exists, with a `#` comment saying so.
- [ ] **Step 6: Dry-run the manifest.** Run `scripts/terminal/branch-cleanup.sh docs/audits/2026-10-21-branch-cleanup-manifest.tsv`. Expected: only `WOULD` lines, with no `REFUSED`. Do not pass `--apply`; that is owner step O5.
- [ ] **Step 7: Commit** `feat: add verified branch cleanup script and 2026-10-21 manifest`.

### Task 7: Memory eval median of runs (on hold)

**Precondition:** This task is on hold. All 10 Sage Evals runs since #256 merged passed. At the old pass rate of about 4 in 5, ten passes in a row would happen only about 11% of the time, so #256 most likely fixed the flakiness. Build this only if a `sage-memory-eval` job fails again on a change that does not touch memory code, and Britt approves (O4). It then goes on its own branch `ci/memory-eval-median` from `origin/main`.

**Files:**
- Create: `scripts/lib/memory-eval-aggregate.mjs`, `scripts/lib/memory-eval-aggregate.test.mjs`
- Modify: `scripts/sage-memory-eval.mjs`, `.github/workflows/sage-evals.yml:232`, `package.json` (extend `test:process-tools`)

**Interfaces:**
- Produces: `parseSamples(argv: string[]): number` (default 1). It throws `RangeError` for even numbers or values below 1.
- Produces: `aggregateRuns(runs: Array<{ duplicateRate: number, hitRate: number }>): { duplicateRate: number, hitRate: number }`. Each field is the median.
- Consumes: the existing `computeMemoryEvalExitCode({ duplicateRate, hitRate })`, unchanged. The floors stay at 0.05 and 0.9. Leak counts are printed per run as today. Whether they should fail the run is decision O7, not part of this task.

- [ ] **Step 1: Write the failing tests.**
  - `median of three hit rates`: input `[0.85, 0.93, 0.95]` gives `hitRate` 0.93.
  - `even samples rejected`: `parseSamples(['--samples=2'])` throws `RangeError`.
  - `default is one`: `parseSamples([])` returns 1.
  - `one run passes through`: `aggregateRuns([{duplicateRate:0.01,hitRate:0.89}])` gives `hitRate` 0.89.
- [ ] **Step 2: Run.** Expected: the tests fail.
- [ ] **Step 3: Implement** the module. Refactor `main()` in `sage-memory-eval.mjs` into `runOnce()`, which seeds, extracts, retrieves, cleans up and returns the rates and leak counts. `main()` then loops `parseSamples(process.argv)` times and prints each run's lines plus a `Median of N` line.
- [ ] **Step 4: Run.** The tests should report `# fail 0`.
- [ ] **Step 5: Change the workflow.** Change `sage-evals.yml:232` to `npm run sage:memory:eval -- --provider=openrouter --samples=3`.
- [ ] **Step 6: Commit** `ci: gate memory eval on the median of three runs`. Open a PR whose body states the floors are unchanged and cites the 2026-07-21 2-of-3 voting precedent.

---

## Owner Steps (Britt, not subagents)

| # | Step | Exact action |
|---|------|--------------|
| O1 | Turn Cron Health green or truly red | Run `gh secret set CRON_CHECK_DATABASE_URL --repo doclegg05/VisionQuest`, paste the postgres-role URL at its prompt, then run `gh workflow run cron-health.yml --repo doclegg05/VisionQuest`. A real failure afterwards means the pg_cron repair (#187 steps) is still due. |
| O2 | Let Benchmarks land results | In GitHub: Settings, then Actions, then General. Enable "Allow GitHub Actions to create and approve pull requests". Then run `gh workflow run benchmarks.yml --repo doclegg05/VisionQuest`. |
| O3 | Cap eval spend | At openrouter.ai, Settings, then Keys: set a monthly credit limit on the key stored as the repo's `OPENROUTER_API_KEY` secret. |
| O4 | Approve the eval gate change, if needed | Only if the memory eval fails again: say yes or no to Task 7 before it is built. |
| O5 | Delete branches | Review the manifest in the PR, then run `scripts/terminal/branch-cleanup.sh docs/audits/2026-10-21-branch-cleanup-manifest.tsv --apply` in the Terminal panel. |
| O6 | Turn on the hook | After the PR merges, run `git config core.hooksPath scripts/git-hooks` in the Terminal panel. No hooks are active today, so nothing is replaced. The setting is shared by every worktree of this repo; one checked out on an older branch simply has no hook. |
| O7 | Decide the memory eval privacy gate | The eval prints staff-memory leak counts as "must be 0", but a leak does not fail the run today. Decide whether it should. If yes, that is a separate small PR extending `computeMemoryEvalExitCode`, which counts as extending a grader, so it is allowed. |

## Execution Notes

- Order: Tasks 1 and 2 first, because Task 2 consumes Task 1. Tasks 3 to 6 touch separate files apart from `package.json`, so run them one after another on the same branch to avoid conflicts there.
- After Task 6, a whole-branch review (sonnet) and then one PR with a test plan checklist.
- Pushing and opening the PR use plain single `git push` and `gh pr create` calls. If the sandbox refuses, Britt runs them in the Terminal panel.
