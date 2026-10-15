# Runbook: Sage eval budget

The model-backed Sage evals in CI cost money, and the repo's standing rule is that an ungraded scenario is not a pass. So a run that could not grade anything must say NOT RUN. It never passes, and it never looks like a code failure.

History. Ticket E8 (2026-09-07) built this guard after six eval runs drained the Gemini prepaid balance on 2026-09-05 and every Sage-touching PR read red for hours. On 2026-10-15 Google rejected the repo's `GEMINI_API_KEY` secret (`API_KEY_INVALID`), and both eval jobs moved their model calls to OpenRouter. Each key's own spending limit replaced the `GEMINI_EVAL_BUDGET_OK` opt-in, which had sat unset for months while every run skipped and read green.

Related files:

- `.github/workflows/sage-evals.yml`
- `scripts/lib/sage-eval-ci-step.mjs` runs every model-backed step and writes its result.
- `scripts/sage-embedding-preflight.mjs` checks that OpenRouter embeddings work.
- `scripts/lib/sage-eval-provider.mjs` holds the classifiers and `reportEvalFailure`.
- `docs/runbooks/openrouter-test-bench.md` covers the OpenRouter key and its privacy settings.

## Which job uses which key

| Job | Steps | Generation | Embeddings |
|---|---|---|---|
| `sage-evals` | red-team, quality (informational), tool selection, chat harness | OpenRouter, `OPENROUTER_API_KEY` | none |
| `sage-memory-eval` | answer quality (informational), memory | OpenRouter, `OPENROUTER_API_KEY` | OpenRouter, `google/gemini-embedding-001` at 768 dimensions |
| `sage-freshness-eval` | freshness | none | none |

CI measures production's model, `google/gemini-3.1-flash-lite`, set as `OPENROUTER_MODEL` in each eval job. `src/lib/ci-sage-evals-openrouter.test.ts` fails if it stops matching `DEFAULT_GEMINI_MODEL`.

No step uses a direct Gemini key (Britt, 2026-10-15). Memory storage, memory retrieval and hybrid RAG embed through the app's own embedding resolver, so the eval harness installs an eval-only override there: `installOpenRouterEvalEmbeddings` in `scripts/lib/sage-eval-provider.mjs` points the resolver at `OpenRouterEmbeddingProvider` (`src/lib/ai/openrouter-embedding-provider.ts`) for every `--provider=openrouter` run. The production server locks the override slot at boot (`src/instrumentation.ts`), and `src/lib/ai/embedding-provider.eval-override.test.ts` fails if anything in app code installs one. OpenRouter's embeddings API takes no task type, so queries and documents embed the same way here, unlike production's Gemini calls.

Every prompt in these jobs is a synthetic fixture. OpenRouter never sees real student data.

Keys are mapped only on the steps that call a model, never at job level, so `npm ci` and the other setup steps never hold one. The workflow has `permissions: contents: read`.

## Setting up the key

Give CI its own key. Then a leaked or looping CI run can only spend what that key allows, and a long local model comparison cannot drain the key the nightly evals depend on.

1. On openrouter.ai, create a separate key named "VisionQuest CI" with a monthly spending limit. In October 2026 one run of the three gating evals on the production model cost $0.10 to $0.17. The workflow runs nightly and on every PR that touches Sage, and a newer push to a PR cancels the older run.
2. Store it as a repository secret. The command prompts for the value, so paste the key there:

   ```bash
   gh secret set OPENROUTER_API_KEY --repo doclegg05/VisionQuest
   ```

3. OpenRouter's privacy settings apply to every key on the account. See setup step 2 in `docs/runbooks/openrouter-test-bench.md`.

The old `GEMINI_EVAL_BUDGET_OK` and `GEMINI_EVAL_BUDGET_SOFT_FAIL` variables do nothing now. Delete them if they exist:

```bash
gh variable delete GEMINI_EVAL_BUDGET_OK --repo doclegg05/VisionQuest
```

## What each outcome means

`scripts/lib/sage-eval-ci-step.mjs` writes one line per step to the job summary. Its tests are `src/lib/sage/eval-ci-step.test.ts`.

| Result | When | Step exit |
|---|---|---|
| PASSED | The eval exited 0 | 0 |
| REPORTED | An informational step (quality, answer quality) exited 0. These have no pass criterion. | 0 |
| FAILED | The eval exited 1 or another code: a red-team hard violation, a tool-selection miss, a memory hit rate under 90% | that code |
| NOT RUN | A secret is missing on a fork PR, which never receives secrets | 0, with a notice |
| NOT RUN | A secret is missing on this repository's own run (nightly, dispatch, or a PR from a branch here) | 4 |
| NOT RUN | Credits or the key's spending limit ran out (exit 3) | 3 |
| NOT RUN | OpenRouter refused the key or model, or could not be reached (exit 4) | 4 |

Setting the repository variable `SAGE_EVAL_SOFT_FAIL=1` turns every NOT RUN exit into 0. FAILED always fails. The quality and answer-quality steps are `continue-on-error`, so their NOT RUN or FAILED shows on the step and in the summary but never fails the job.

`SAGE_EVAL_REQUIRED` tells the runner which runs are this repository's own. The workflow sets it from the event, so it needs no setup.

## How the scripts decide exit 3 and 4

`resolveEvalProvider` in `scripts/lib/sage-eval-provider.mjs` wraps the provider. The wrapper rethrows these errors as not-run errors and passes every other error through unchanged:

- An OpenRouter `credits` error (402, or a 403 naming the key limit) is exit 3.
- An OpenRouter 400, 401 or 404 is exit 4. Any other 403 is an ordinary failure.
- A network failure before any call has succeeded is exit 4.
- For a local `--provider=gemini` run, a Gemini 429 whose body names the drained-wallet shape (`prepayment`, credits depleted, quota exhausted) is exit 3. An ordinary per-minute rate limit is also a 429, and it stays a normal failure.

Each eval's `main().catch(reportEvalFailure)` sets the exit code. Every per-case catch in the eval scripts rethrows these errors, so a not-run run stops at once instead of grading each case as a miss.

The app swallows two kinds of error that would otherwise turn NOT RUN into FAILED:

- Memory extraction never throws to its caller. The memory eval wraps its provider with `trackEvalAborts` and rethrows the first not-run error after each extraction.
- Memory storage, memory retrieval and hybrid RAG swallow embedding errors. For the two embedding steps, the runner makes one OpenRouter embedding call before the eval. If OpenRouter refuses the key or model or the credits are gone, the step reads NOT RUN and the eval never starts. If the eval then fails, the runner checks again, and reports NOT RUN if embeddings stopped working during the run.

## Merging with a NOT RUN eval

A NOT RUN result never substitutes for a green gating eval on a Sage PR. Before merging a PR whose red-team, tool-selection, chat-harness or memory eval reads NOT RUN:

1. Fix the cause the summary line names: the secret, the key's limit, or the credits.
2. Re-run the workflow:

   ```bash
   gh workflow run sage-evals.yml --ref <branch> --repo doclegg05/VisionQuest
   ```

3. Confirm each gating step reads PASSED before merging.
