# Local EmbeddingGemma 2 and Gemma 4 12B

Installed and synthetically validated on the owner's Mac, 2026-10-08. Production
activation is authorized but remains pending secured connectivity and release checks.
The migration commands below are explicit operator actions, never application startup tasks.

## Runtime

The official `google/embeddinggemma-2` checkpoint is pinned to
`914f7f89142e33e77833254d9c9b90c3cef7303b`. The full checkpoint is downloaded;
the bridge loads its text encoder only, using float32 on Apple MPS and producing
normalized 768-dimensional vectors. Image/audio/video inference has not been tested.

Ollama 0.35.1 rejected `embeddinggemma-2:740m` with HTTP 412 (newer runtime required).
The isolated runtime uses Python 3.12.13, SentenceTransformers 6.1.0,
Transformers 5.19.0, and PyTorch 2.14.1. Existing Ollama and its models are preserved.
See [Google's guide](https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/).

Persistent installation: `~/.local/share/visionquest/embeddinggemma-2/`.
It contains `model/`, `venv/`, `requirements.lock.txt`, `installation.json`,
`verification.json`, `embed`, and `bridge.py`.
The weights' SHA-256 is
`197a32965d4b1105faf060417baa899e193fb73cd401f42ec9295234d5553d79`.

The per-user LaunchAgent `~/Library/LaunchAgents/com.visionquest.embeddinggemma2.plist`
starts the bridge at login, restarts on failure, and logs in the installation directory.
Its executable and model paths are outside the worktree. The maintained source is
[`scripts/embeddinggemma-bridge.py`](../../scripts/embeddinggemma-bridge.py).
After changing that source, copy it to the persistent installation and restart:

```sh
cp scripts/embeddinggemma-bridge.py "$HOME/.local/share/visionquest/embeddinggemma-2/bridge.py"
launchctl kickstart -k "gui/$(id -u)/com.visionquest.embeddinggemma2"
curl http://127.0.0.1:11436/health
```

Stop it with `launchctl bootout "gui/$(id -u)/com.visionquest.embeddinggemma2"`.
Restart registration with `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.visionquest.embeddinggemma2.plist"`.

## VisionQuest settings and activation boundary

For a VisionQuest app running on the **same Mac**, Program Setup → AI Provider:

| Setting | Value |
| --- | --- |
| Provider | Local |
| Server URL | `http://127.0.0.1:11436` |
| Model | `gemma4:12b` (fixed for every local generative job) |
| Embedding model | `google/embeddinggemma-2` |
| API style | Ollama |
| Endpoint authentication | None (loopback only) |

The bridge forwards only Gemma 4 12B chat/generation requests to the existing Ollama
on port 11434. It serves embeddings itself, keeps weights loaded, limits batches
to 96, and rejects inputs exceeding 8192 tokens rather than silently truncating.
Only these two models appear in its model list. It does not pull or delete models.
VisionQuest also ignores old global/per-role local model overrides and rejects new
alternate local model choices at the settings API. Cloud selection/policy is unchanged.

Do not enter a Mac loopback URL in Render: it would refer to Render itself.
Hosted activation needs deployment of these changes, an explicitly approved secured
route to this bridge, and corpus migration. The bridge deliberately binds only to
127.0.0.1 and has no public authentication layer. No tunnel or production config was changed.

Keep the public app at `https://visionquest.onrender.com`. Render's assigned app
hostname does not itself provide connectivity to the Mac, and we do not control
`onrender.com` DNS. A separate persistent backend transport is still pending a
decision. It must work without purchasing a domain. Historical local-AI settings
and scripts point at LeggAI infrastructure; they are not authorization to reuse
that hostname, tunnel, or credentials. Do not migrate a domain's nameservers,
create a new networking service, or select a paid plan as an incidental step.

## Existing-index compatibility

768 dimensions match the database column width, but **do not make different models'
vectors comparable**. VisionQuest stores and filters `embeddingModel` for documents,
chunks, and memories; the canonical identity here is `google/embeddinggemma-2`.
The adapter adds `task: search result | query: ` for queries and
`title: none | text: ` for documents. Existing models' input formatting is unchanged.

The form cache is keyed by the model that produced the query. Memory queries and
writes retain the actual producing model returned by the embedding adapter, so a
concurrent settings change cannot mislabel a vector or compare two vector spaces.

## Recoverable production migration

`scripts/migrate-embeddinggemma-index.mjs stage` reads source records, generates
embeddings through the loopback bridge, and writes an owner-only snapshot under the
persistent installation's `migrations/` directory. It makes **no database writes**.
The snapshot contains source hashes, record IDs, previous vectors/model tags,
replacement vectors, and the seven routing settings affected by activation. It does
not store source text or authentication secrets. Treat vectors as protected derived
data and retain the snapshot privately until rollback is no longer needed.

Staging includes all chunks, active memories plus historical memories with vectors,
and active Sage documents plus historical documents with vectors. The initial
production staging covered 71 document vectors, 257 chunks, and 57 memories. The
active retrieval corpus had 67 documents. Counts must be refreshed at activation.

```sh
node --env-file=/private/path/production.env scripts/migrate-embeddinggemma-index.mjs stage
node --env-file=/private/path/production.env scripts/migrate-embeddinggemma-index.mjs activate /private/path/staged.json --apply --endpoint=https://secured-host.example --auth-mode=cloudflare_service_token
```

Verify the authenticated endpoint from Render before activation, including rejecting
requests without credentials. Credentials must already be configured for the app's
production encryption key. Activation takes table locks inside one serializable
transaction, validates source hashes, membership, prior vectors and settings, then
switches the vectors and routing settings together. It sets `local_only`, the
canonical embedding model, and `gemma4:12b`. Any stale source or config aborts the
transaction; stage again instead of forcing it. Restart the app after the switch to
discard cached settings, then run index-integrity and authenticated synthetic checks.

Rollback restores the snapshot's vectors and routing settings in one transaction:

```sh
node --env-file=/private/path/production.env scripts/migrate-embeddinggemma-index.mjs rollback /private/path/staged.json --apply
```

Rollback refuses changed source content or membership and requires reconciliation
if records were added after activation. Inspect the previous routing policy before
using it: restoring a prior cloud setting is a policy change, not simply a vector
repair. Receipt files prevent blind replays after an uncertain outcome. Never delete
a receipt to force production replay; inspect live state first.

The transaction test creates and destroys its own temporary PostgreSQL/pgvector
cluster, ignoring any existing database URL. It verifies activation, exact vector and
setting restoration, and atomic refusal when a later table or configuration changes:

```sh
VQ_TEST_MIGRATION_DB=1 PG_BIN=/path/to/postgres/bin node --test scripts/migrate-embeddinggemma-index.test.mjs
```

## Resource limits

The bridge serializes embedding requests and uses model batches of eight. Migration
is more conservative: one request of four inputs at a time, with a 100 ms yield.
Chat forwarding is independent. A bounded synthetic coexistence check completed a
four-input embedding batch in 1.35 seconds while a 128-token chat completed in 12.47
seconds; the sampled system had 40% free memory and no swap. This is a small-load
check, not a multi-student capacity claim. Avoid overlapping an unrestricted unit
suite, production build, and model evaluations; use test concurrency two and run
builds separately on this 32 GB Mac.

## Verification

```sh
"$HOME/.local/share/visionquest/embeddinggemma-2/embed" --self-test
"$HOME/.local/share/visionquest/embeddinggemma-2/embed" --task query "How do I prepare for an interview?"
VQ_TEST_EMBEDDING_BRIDGE=1 npx tsx --test --experimental-test-module-mocks src/lib/ai/embeddinggemma-bridge.test.ts
```

Direct offline check: seven finite, normalized 768-dimensional vectors; three of
three queries ranked their matching document first. The live TypeScript adapter
check exercises both native and OpenAI-compatible embeddings, verifies query-prefix
consistency, matches three of three synthetic retrieval cases, checks the restricted
model list, and rejects a 26B chat request. The bridge also returned `Ready` from a
real Gemma 4 12B chat request. These are synthetic integration checks, not a production
Sage quality benchmark or an end-to-end authenticated UI test.

### Tool-evaluation context correction

The original first-tool benchmark scored 33/45 (73.3%) after the routing-guidance
fix, below its 75% floor. Four cases expected `submit_form` or `save_job` without
providing required database identifiers. Controlled paired runs selected lookups
without those IDs and the correct action with exact IDs when context was supplied.
The runner also overwrote scenario context whenever an attachment was present.

The corrected protocol retains all 45 gating cases and the 75% floor. It supplies
the missing checklist/search-result IDs for those four cases, preserves context
alongside attachments, and requires exact identifier arguments as well as the tool
name. It executes no real handlers. Results from this corrected protocol must be
labeled separately from the original benchmark; a score increase after the fixture
repair is not solely a model or prompt improvement. Fresh production-prompt checks
and the original failures remain part of the acceptance evidence.
