# Runbook — Sage eval budget guard

Ticket E8 (2026-09-07). On 2026-09-05 six eval runs drained the Gemini
prepaid balance and every Sage-touching PR read red for hours on a 429
"prepayment credits depleted" — under the repo's standing rule an ungraded
scenario is not a pass, so a drained wallet blocked merges exactly like a
real safety regression would, with nothing in the log to tell the two apart.
This guard makes a drained wallet read as **NOT RUN**, never as a pass and
never as a code failure.

Related: `.github/workflows/sage-evals.yml`, `scripts/lib/sage-eval-provider.mjs`
(the `isBudgetExhausted` classifier, `EvalBudgetExhaustedError`,
`reportEvalFailure`), `.claude/rules/sage-ai.md`.

## The two variables

Both are **repository variables** (Settings → Secrets and variables →
Actions → **Variables** tab — not Secrets; there is nothing sensitive in
either value), read in the workflow as `${{ vars.NAME }}`.

| Variable | Values | Meaning |
|---|---|---|
| `GEMINI_EVAL_BUDGET_OK` | `1` / unset (or anything else) | **Pre-flight** gate. `1` means an operator has just confirmed the Gemini project's prepaid balance can absorb this run. Unset (the default) means every model-backed step skips before spending a token: it prints a `::warning::` and a step-summary line and exits 0. This is deliberately separate from `GEMINI_API_KEY` — the key can be valid while the wallet behind it is empty, which is exactly what happened on 2026-09-05. |
| `GEMINI_EVAL_BUDGET_SOFT_FAIL` | `1` / unset (or anything else) | **Runtime** behavior when the wallet turns out to be empty mid-run anyway (see "How a drained wallet is detected" below). `1` downgrades that outcome to a `::warning::` + exit 0. Unset (the default) keeps the job **failing** — the standing rule is that an ungraded scenario is not a pass, so a mid-run drain still blocks a Sage-touching PR by default. Either way the log names the cause instead of a bare non-zero exit. |

Both are wired into the `sage-evals` and `sage-memory-eval` jobs. The
red-team, quality, tool-selection, chat-harness, and memory eval steps each
carry both guards. `sage-freshness-eval` does **not** — it calls no model at
all (see the doc comment at its job's top: "Fully deterministic (no model)"),
so a budget guard there would gate a job that was never going to spend
anything.

## What each state means, end to end

1. **`GEMINI_API_KEY` unset** — unchanged from before this ticket: the step
   prints `::notice::` and exits 0. No behavior change here.
2. **`GEMINI_API_KEY` set, `GEMINI_EVAL_BUDGET_OK` not `1`** — the step never
   calls the model. Prints `::warning::GEMINI_EVAL_BUDGET_OK is not 1 —
   model-backed eval skipped (not run, not passed)` and a step-summary line,
   exits 0. The job is green, but a Sage-touching PR still needs a REAL run
   before merge — see "Merging with a NOT RUN eval" below.
3. **Both set, the wallet is actually funded** — runs exactly as it always
   has. No behavior change.
4. **Both set, but the wallet runs out mid-run** — the shared classifier
   (below) catches it, the script exits 3 instead of the ordinary 1, and the
   workflow step prints `::warning::` + a step-summary line either way. It
   then exits 0 only if `GEMINI_EVAL_BUDGET_SOFT_FAIL` is `1`; otherwise it
   re-exits 3 and the job fails (default).
5. **Any other failure** (a real safety/accuracy regression, a network
   error, a bug) — exits 1, unchanged. Nothing about this ticket changes
   what a real failure looks like.

## How a drained wallet is detected at runtime

`scripts/lib/sage-eval-provider.mjs` wraps the resolved `AIProvider` (both
Gemini and Ollama — Ollama errors never match, so wrapping is unconditional
and costs nothing) so any error a live call throws is inspected:

- `isBudgetExhausted(status, bodyText)` is `true` **only** for a 429 whose
  body names the specific "wallet is empty" shape (`prepayment`, a
  `credit(s)` phrase paired with `depleted`/`exhausted`/`insufficient`, or
  `quota` paired with `exhaust`). An **ordinary per-minute rate limit** is
  also a 429 and must stay a normal, retryable failure — Gemini's stock
  message for that case is "You exceeded your current quota, please check
  your plan and billing details," which does not match. Reclassifying an
  ordinary rate limit as "not run, budget" would hide a real problem behind
  a shrug.
- A match is rethrown as `EvalBudgetExhaustedError`; anything else passes
  through completely untouched.
- Each eval script's top-level `main().catch(reportEvalFailure)` checks
  `instanceof EvalBudgetExhaustedError`: on a match it prints
  `::error::Gemini budget exhausted — evals not run` and sets exit code
  **3**; otherwise it behaves exactly as before (`console.error` + exit 1).

This lives in `sage-redteam-eval.mjs`, `sage-agent-eval.mjs`,
`sage-chat-harness.mjs`, and `sage-memory-eval.mjs` — the four scripts that
call a live model through `resolveEvalProvider`. `sage-freshness-eval.mjs`
never resolves a model provider, so it has nothing to classify and was left
untouched. `sage-quality-eval.mjs` also resolves a provider through the same
chokepoint and its `main().catch()` goes through `reportEvalFailure` too, so a
budget-drained run there exits 3 like the others; its workflow step stays
non-gating (`continue-on-error: true`), so the exit code only changes the label.

## Topping up the wallet

The Gemini project (`GEMINI_API_KEY`'s Cloud project) is confirmed on the
**paid tier** (Britt, 2026-09-07) — Google's no-training terms apply, and the
billing model is prepaid credits against that Cloud project.

1. Google Cloud Console → the project behind `GEMINI_API_KEY` → **Billing**.
2. Confirm the billing account is active, then add credit / raise the budget
   per the account's normal top-up flow (this is a Google Cloud billing
   action — there is no VisionQuest-side lever beyond the two variables
   above).
3. Once funded, set the repo variable `GEMINI_EVAL_BUDGET_OK=1` for the run(s)
   that need it. Consider a billing alert on the Cloud project so a drain
   shows up before six eval runs find it the hard way (open item, not built
   here).
4. If a PR's gating evals read **NOT RUN** (state 2 above), that PR is not
   mergeable as-is — see the next section.

## Merging with a NOT RUN eval

**The standing rule is unchanged: an ungraded scenario is not a pass, so a
NOT RUN result never substitutes for a green gating eval on a Sage-touching
PR.** `GEMINI_EVAL_BUDGET_OK` exists so CI can say *why* nothing ran — "the
wallet wasn't confirmed funded," not "something is broken" — never to let a
PR through without the eval actually running. Before merging a PR whose
red-team, tool-selection, chat-harness, or memory eval reads NOT RUN:

1. Confirm/top up the wallet (above).
2. Set `GEMINI_EVAL_BUDGET_OK=1`.
3. Re-run the workflow (`workflow_dispatch`, or push a commit — the PR path
   filter re-fires it on any push touching `src/lib/sage/**`,
   `config/sage-*.json`, `scripts/sage-*.mjs`, or `scripts/lib/**`).
4. Confirm the step actually ran (not another NOT RUN) before merging.

## Reading the log

Every state above prints a `::warning::` or `::error::` annotation (visible
in the GitHub Checks UI, not just the raw log) and a step-summary line, so
"why didn't this run" is answerable without opening the full log:

- `GEMINI_EVAL_BUDGET_OK is not 1 — model-backed eval skipped (not run, not
  passed)` — pre-flight skip, nothing was spent.
- `Gemini budget exhausted at runtime — <eval> NOT RUN (not a pass, not a
  code failure)` — the wallet ran out mid-run; check whether
  `GEMINI_EVAL_BUDGET_SOFT_FAIL` was `1` (job passed) or unset (job failed,
  by design) by reading whether the job is actually green.
- `Gemini budget exhausted — evals not run` (`::error::`, from the script
  itself) — the same event, logged by the script before the workflow's own
  annotation.

Anything else (a red-team hard violation, a tool-selection accuracy miss, a
guardrail failure) prints its own, unrelated message and is a real finding —
this guard does not touch that path at all.
