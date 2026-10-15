# Runbook: Sage eval budget

The model-backed Sage evals in CI cost money, and the repo's standing rule is
that an ungraded scenario is not a pass. So a run that could not grade
anything must say **NOT RUN**, never pass and never look like a code failure.

History: ticket E8 (2026-09-07) built this guard after six eval runs drained
the Gemini prepaid balance on 2026-09-05 and every Sage-touching PR read red
for hours. On 2026-10-15 the `sage-evals` job moved from the Gemini API to
OpenRouter, and the OpenRouter key's own spending limit replaced the
`GEMINI_EVAL_BUDGET_OK` opt-in for that job.

Related: `.github/workflows/sage-evals.yml`, `scripts/run-sage-eval-step.sh`,
`scripts/lib/sage-eval-provider.mjs`, `docs/runbooks/openrouter-test-bench.md`.

## Which job uses which key

| Job | Steps | Key (repository secret) | Budget control |
|---|---|---|---|
| `sage-evals` | red-team, quality (informational), tool selection, chat harness | `OPENROUTER_API_KEY` | The key's monthly spending limit on OpenRouter |
| `sage-memory-eval` | answer quality (informational), memory | `GEMINI_API_KEY` | `GEMINI_EVAL_BUDGET_OK` and `GEMINI_EVAL_BUDGET_SOFT_FAIL` (below) |
| `sage-freshness-eval` | freshness | none | none: it calls no model |

The memory job stays on Google because its evals store embeddings, and the
app's embeddings come from Google's embedding API. It moves when an
OpenRouter embedding provider exists.

## Setting up the OpenRouter key for CI

1. On openrouter.ai, create a separate key named "VisionQuest CI" with a
   monthly spending limit. In October 2026 one run of the three gating evals
   on the production model cost $0.10 to $0.17; the workflow runs nightly and
   on every PR that touches Sage.
2. Store it as a repository secret named `OPENROUTER_API_KEY`:

   ```bash
   gh secret set OPENROUTER_API_KEY --repo doclegg05/VisionQuest
   ```

   It prompts for the value; paste the key there. Or use GitHub: Settings,
   Secrets and variables, Actions, New repository secret.
3. The account's privacy settings apply to every key on the account. See
   setup step 2 in `docs/runbooks/openrouter-test-bench.md`.

The model is set once, as `OPENROUTER_MODEL` in the `sage-evals` job.

## What each outcome means (`sage-evals` job)

`scripts/run-sage-eval-step.sh` wraps each step (tests:
`scripts/run-sage-eval-step.test.mjs`).

1. **No `OPENROUTER_API_KEY` secret.** The step prints
   `::notice::OPENROUTER_API_KEY not set, skipping <eval>.`, adds a NOT RUN line
   to the job summary and exits 0. Forks and secret-less runs stay green.
2. **Key set, eval runs.** It passes or fails on its own result.
3. **Credits or the key's spending limit run out.** The eval exits 3. The step
   prints `::warning::<eval> NOT RUN: OpenRouter credits or the key's spending
   limit ran out` and a summary line, then fails.
4. **OpenRouter, the model or the key is unavailable**: a key OpenRouter does
   not accept (401), an unknown model (400), a model with no endpoint that
   meets the account's retention settings (404), or no connection before any
   call succeeded. The eval exits 4. The step prints
   `::warning::<eval> NOT RUN: OpenRouter, the model or the key was
   unavailable` and a summary line, then fails.
5. **Anything else**, such as a red-team hard violation or a tool-selection
   miss, exits 1 and is a real finding.

Setting the repository variable `SAGE_EVAL_SOFT_FAIL=1` lets outcomes 3 and 4
pass instead of failing. Outcome 5 always fails.

The evals decide exit 3 and 4 in `scripts/lib/sage-eval-provider.mjs`: an
OpenRouter `credits` error (402, or a 403 naming the key limit) is exit 3; a
400, 401 or 404, or a network failure before any call succeeded, is exit 4.
Any other 403 is an ordinary failure.

## The memory job's Gemini guard

`sage-memory-eval` keeps the 2026-09-07 guard. Both values are repository
variables (Settings, Secrets and variables, Actions, Variables tab).

| Variable | Meaning |
|---|---|
| `GEMINI_EVAL_BUDGET_OK` | `1` means an operator confirmed the Gemini project's prepaid balance can absorb the run. Anything else skips the step with a warning and a summary line, before any spending. |
| `GEMINI_EVAL_BUDGET_SOFT_FAIL` | `1` lets a run that drains the wallet mid-way pass with a warning. Anything else fails the job. |

Without `GEMINI_API_KEY` the memory steps skip with a notice. A drained Gemini
wallet is recognized only from a 429 whose body names prepaid credits as
depleted or exhausted (`isBudgetExhausted`), so an ordinary per-minute rate
limit stays a normal, retryable failure.

## Merging with a NOT RUN eval

A NOT RUN result never substitutes for a green gating eval on a Sage-touching
PR. Before merging one whose red-team, tool-selection, chat-harness or memory
eval reads NOT RUN:

1. Fix the cause: add the secret, raise the key's limit or add credits.
2. Re-run the workflow (`workflow_dispatch`, or push a commit; the PR path
   filter fires on `src/lib/sage/**`, `config/sage-*.json`,
   `scripts/sage-*.mjs`, `scripts/lib/**`, `scripts/run-sage-eval-step.sh`
   and the workflow file itself).
3. Confirm the step ran before merging.
