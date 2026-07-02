# Local AI Operator Runbook

**Created:** 2026-07-02
**Audience:** the operator running the always-on local AI host (technical,
but not necessarily a developer). Covers install → tunnel → admin config →
test → embedding cutover → model swaps → acceptance → troubleshooting.

**Reflects code as of this branch:** capability detection + installed-model
picker (`src/lib/ai/capabilities.ts`), generic OpenAI-compatible endpoint
mode (`src/lib/ai/local-config.ts`), and the Program Setup AI Provider panel
(`src/components/teacher/AiProviderPanel.tsx`).

## 1. Install Ollama and pull models

On the always-on host (the machine that stays on and runs the local model):

1. Install Ollama from https://ollama.com/download.
2. Pull a chat model. Pin an explicit tag — never `:latest`:

```
ollama pull gemma4:8b-q4_K_M
```

   Why pin a tag: the code's default constant is `gemma4:26b`
   (`DEFAULT_OLLAMA_MODEL` in `src/lib/ai/local-config.ts`), but the model
   actually pulled on the current host is `gemma4:latest` (an 8B build). A
   `:latest` tag can silently change size/weights on a future `ollama pull`
   with no warning — you'd only notice from a capability regression. Use an
   explicit, versioned tag (e.g. `gemma4:8b-q4_K_M`) and set that exact
   string in the admin **Model name** field (step 3), so what you tested is
   what stays running.

3. Pull the embedding model:

```
ollama pull nomic-embed-text
```

   `nomic-embed-text` is the supported 768-dim embedding model (matches the
   `EMBEDDING_DIMENSIONS` constant Sage's pgvector column is fixed to).
   `embeddinggemma` also works. Do **not** use a 1024-dim model such as
   `mxbai-embed-large` — the app will refuse it (see step 4).

4. Verify both are pulled:

```
ollama list
```

## 2. Tunnel

Do not re-derive tunnel setup here — follow the existing recommendation in
[2026-04-15-local-ai-tunnel-recommendation.md](./2026-04-15-local-ai-tunnel-recommendation.md):
a stable Cloudflare Tunnel hostname (e.g. `llm.yourdomain.com`) plus
Cloudflare Access service-token protection. Do not point production Sage
traffic at an ephemeral `ngrok free` URL.

Quick local health check before touching admin config:

```
curl http://127.0.0.1:11434/api/tags
```

Expect `200 OK` with a JSON list of installed models. If this fails, nothing
downstream (tunnel, admin config) can work — fix Ollama first.

## 3. Admin config — Program Setup > AI Provider

1. Log in as an admin teacher account and go to **Program Setup**
   (`/teacher/manage`). The **AI Provider** section is admin-only.
2. Choose **Local AI Server**.
3. Fill in the fields:
   - **Server URL** — your stable Cloudflare Tunnel hostname (e.g.
     `https://llm.yourdomain.com`), or `http://localhost:11434` for local
     dev only. Never a raw ngrok free URL in production.
   - **Model name** — the exact chat model tag you pulled in step 1 (e.g.
     `gemma4:8b-q4_K_M`). Free text is always allowed, even for models not
     yet pulled — but until it's pulled, Test Connection will fail on it.
   - **Server API style** — `Ollama` for native Ollama, or
     `OpenAI-compatible (LM Studio, vLLM, llama.cpp)` for servers that only
     expose `/v1/*` endpoints. Ollama supports both; Sage tries both
     automatically when you pick `Ollama`. Pick `OpenAI-compatible` only
     for non-Ollama servers, so Sage never wastes a round trip probing
     Ollama-only routes against them.
   - **Embedding model name** — `nomic-embed-text` (or `embeddinggemma`).
   - **Endpoint authentication** — `None`, `Bearer token`, or `Cloudflare
     service token`. For production behind Cloudflare Access, use
     `Cloudflare service token`.
   - **Auth credentials** — in production, prefer environment-variable
     fallbacks over typing secrets into the admin form: set
     `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (or the
     `AI_PROVIDER_CLOUDFLARE_ACCESS_*` aliases) in Render's environment.
     These are used automatically when no encrypted config value is saved,
     and they survive a database encryption-key rotation that would
     otherwise break a saved-in-DB credential.
   - **Context window (num_ctx)** — leave blank to use the default unless
     you have a specific reason to raise it (longer agent transcripts need
     more VRAM per concurrent request).
4. Click **Save Provider Settings** first — Test Connection reads the saved
   config, not the unsaved form state.
5. Click **Test Connection** — see step 4 below for reading the result.

Once you've run Test Connection at least once, the **Model name** and
**Embedding model name** fields turn into a dropdown-with-free-text
(populated from whatever Ollama reports as installed), so you can pick any
already-pulled model without retyping its exact tag.

## 4. Test Connection — reading the capability report

Click **Test Connection**. A short status line appears first (models
loaded, chat path, auth mode). Below it, a **Model capabilities** panel
shows four rows, each green (checkmark) or amber (warning triangle):

| Row | Green means | Amber means |
|---|---|---|
| **Chat** | A real chat completion round-tripped successfully against the configured model. | Model not pulled, endpoint unreachable, or the chat call errored — check the warnings list below the grid. |
| **Tool calling** | The model accepted a tool/function declaration without erroring (a no-op probe tool it isn't asked to call). | Model or server doesn't support tool calling — Sage's agent loop (goal extraction, career tools, etc.) may degrade or fail on this model. |
| **JSON output** | The model returned parseable JSON when asked for `{"ok": true}`. | Model can't reliably produce structured JSON — this affects goal extraction and other structured-output paths. |
| **Embeddings (768-dim)** | The embedding model returned exactly 768-dim vectors. | Wrong embedding model (wrong dimension count) or embedding model not pulled — see the warnings list for the exact `ollama pull` command to run. |

**Embeddings must show green (768-dim) before you cut over embeddings** —
see the checklist in section 5. A red/amber embeddings row after cutover
means retrieval (Sage's RAG grounding) will silently degrade or fail.

If **Detected context length** appears, that is a best-effort read from the
model's own metadata (native Ollama only) — informational, not a pass/fail
signal.

Any warnings under the grid are plain-language and often actionable
directly (e.g. `nomic-embed-text not pulled — run: ollama pull
nomic-embed-text`).

## 5. Embedding cutover checklist

Embeddings are different from chat: **switching the chat model is a config
change, but switching the embedding model requires re-embedding everything**
(see section 6 for why). Follow this order — do not skip steps:

1. In Program Setup > AI Provider, set **Embedding model name** to the new
   model and **Save Provider Settings**.
2. Run **Test Connection** and confirm the **Embeddings (768-dim)** row is
   green before proceeding.
3. Re-embed everything on the new model:

```
npm run sage:rag:backfill -- --reembed
```

   This re-embeds stale `ProgramDocument` chunks and `SageMemory` rows in
   one pass (`scripts/backfill-embeddings.mjs`). It runs against
   `DATABASE_URL` from your local `.env.local` / shell environment — this
   is a **write** operation on the embeddings table, so make sure you're
   pointed at the environment you intend to change.

   If you don't have local shell access to the app's DB, use the
   production equivalent (same flow, different trigger):

```
curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"reembed": true}'
```

4. Confirm the backfill completed cleanly. The CLI prints a summary line:
   `Done: N embedded, N skipped, N without body text, N errors`. The
   memory re-embed prints its own `Memories: N re-embedded, N errors`
   line. Any `errors > 0` means don't consider this cutover complete —
   investigate before moving on.
5. Sanity-check retrieval quality on the new embeddings:

```
npm run sage:rag:harness
```

   This replays known question/answer pairs against real retrieval
   (`scripts/sage-rag-harness.mjs`) and reports whether the expected
   document is actually retrieved. A drop in hit rate after a model swap
   means the new embedding model is a worse fit — don't treat "it ran" as
   "it's fine."

## 6. Model swap / upgrade checklist

**Chat model swap — config change only:**

1. Pull the new model tag: `ollama pull <new-tag>`.
2. Program Setup > AI Provider > **Model name** → new tag → **Save**.
3. **Test Connection** and confirm Chat / Tool calling / JSON output are
   green.
4. Run the acceptance check in section 7 before trusting it with real
   student traffic.

**Embedding model swap — config change AND re-embed:**

Follow the full checklist in section 5. Do not just change the config
field and stop.

**Why embeddings are different from chat:** a chat call is stateless — swap
the model name and the very next message uses it. Embeddings are not:
every vector already stored in the database was generated by whatever
embedding model was active *when it was written*, and vectors from
different models aren't comparable (different models place similar text
at different points in vector space). Swap the embedding model without
re-embedding and new queries get compared against old, incompatible
vectors — similarity scores become meaningless and retrieval quality
silently degrades, with no error message.

## 7. Acceptance before trusting a new model

Before relying on any new or swapped chat model for real student
conversations, run the chat-level golden harness against it and compare
to the Gemini baseline:

```
npx tsx scripts/sage-chat-harness.mjs --provider=ollama --strict
```

This replays deterministic scenarios (tool selection, guardrails,
grounding, memory recall, readability) against the real system prompt and
real tool registry. `--strict` exits non-zero on any deterministic
failure, so a clean exit code is a real pass/fail signal, not just a
report to eyeball.

Compare the result against a same-day Gemini run:

```
npx tsx scripts/sage-chat-harness.mjs --strict
```

(Gemini is the default provider when `--provider` is omitted.)

**Phase 5 acceptance thresholds are proposed, not yet finalized** — treat
any pass/fail bar you see referenced elsewhere as pending operator
confirmation, not a settled gate. Until Phase 5 formally sets thresholds,
use your judgment: a new local model should not fail deterministic cases
Gemini passes, and readability scores (when `--judge=gemini` is used)
should not regress meaningfully.

## 8. Troubleshooting

| Symptom | Likely cause | Check first |
|---|---|---|
| Chat errors with `AI_STREAM_FAILED`, or Test Connection reports a `502`/`530` | Tunnel or Cloudflare Access edge, not the model or the app | On the local AI host: is `cloudflared` running? Is the "Sage Tunnel" scheduled task active? Then confirm `curl http://127.0.0.1:11434/api/tags` returns 200 locally — if localhost is healthy but the public hostname isn't, it's a tunnel/Access problem, not an Ollama problem (see the tunnel doc's 2026-05-13 follow-up). |
| Test Connection shows the **Embeddings (768-dim)** row amber with a dimension-mismatch warning | Configured embedding model returns the wrong vector size (e.g. a 1024-dim model like `mxbai-embed-large`) | Switch **Embedding model name** to `nomic-embed-text` or `embeddinggemma`, save, re-test. If you already wrote vectors with the wrong model, you also need the full re-embed checklist in section 5. |
| Chat streams back empty / no tokens | Configured model isn't actually pulled on the host | `ollama list` on the host — if it's missing, `ollama pull <model>`. Test Connection's warnings list will also say `<model> not pulled — run: ollama pull <model>` when this is the embedding model. |
| First reply after idle time is very slow (20–45+ seconds) | Model was unloaded from VRAM (Ollama's default `keep_alive` idle timeout) — this is a cold load, not a hang | Expected behavior on first use after idle. The app calls `GET /api/chat/warmup` on chat page mount to pre-warm the model, and `scripts/warm-sage-model.ps1` is registered as the "Sage Model Warmup" scheduled task (logon + daily 07:30) to keep it resident during the workday. If mornings are still slow, confirm that scheduled task is enabled on the host. |
| Test Connection succeeds but **Tool calling** or **JSON output** is amber | The model itself doesn't support function calling or structured JSON well | This is a model capability gap, not a config bug — try a different model, or accept degraded agent-loop behavior (goal extraction, career tools) on this model. |
| Everything green in Test Connection, but retrieval quality looks worse after a model swap | Embedding model changed without a full re-embed, or the new model is a genuinely worse semantic fit | Re-run section 5's checklist end to end, including `npm run sage:rag:harness` afterward — don't rely on "capabilities are green" alone, that only confirms *dimension* match, not retrieval *quality*. |

## Related docs

- [2026-04-15-local-ai-tunnel-recommendation.md](./2026-04-15-local-ai-tunnel-recommendation.md) — tunnel architecture and history, do not duplicate here
- [pg-cron-setup-runbook.md](./pg-cron-setup-runbook.md) — style reference for this doc
