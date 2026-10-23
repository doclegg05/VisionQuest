# VisionQuest Render-to-Mac connection

The Mac initiates an authenticated WSS connection to the existing VisionQuest web
service. No Mac port is publicly exposed, and no DNS, new hosting service, tunnel
account, or historical LeggAI credentials are involved. Inference remains on the
Mac's approved Gemma 4 12B variant with a 16K context window through native Ollama on loopback port 11434.

```text
Browser → existing Render HTTPS app → authenticated loopback adapter :11437
                                        ↕ authenticated WSS
                               Mac agent → native Ollama 127.0.0.1:11434
```

This implementation supports the service's current **single instance**. Do not
scale it horizontally without adding explicit agent-to-instance routing. Deploys
can interrupt in-flight replies; they fail closed and are never replayed. The
agent reconnects with backoff. The deployment-wide cloud-inference fence remains
on, including background work. Enabling the Mac relay itself also activates the
cloud fence, independently of the demo entry switch. Embeddings are still blocked under the existing
cloud configuration; this change does not migrate or mix vector indexes.

## Render settings

Start command: `npm run prisma:migrate:deploy && npm start`. The wrapper starts
Next on loopback port 3001 and proxies ordinary HTTP/SSE traffic through the
existing public port. Only `/__visionquest/local-ai/agent` accepts an authenticated
WebSocket upgrade; browser-origin connections are refused.

Set these server-only environment values:

- `VQ_MAC_RELAY_ENABLED=true`
- `VQ_MAC_RELAY_AGENT_TOKEN`: 32 random bytes encoded as 64 lowercase hex characters.
- `VQ_MAC_RELAY_APP_TOKEN`: an independent token in the same format.
- `COHORT_DEMO_MODE=true`
- `COHORT_DEMO_LOCAL_ONLY=true`
- `COHORT_DEMO_LOCAL_AI_ORIGIN=http://127.0.0.1:11437`

The dedicated local adapter overrides the old provider URL and authentication
settings without reading or modifying them. The approved loopback origin refers
to the adapter **inside Render**, not to the Mac. The adapter forwards requests
only over the authenticated Mac connection. Its app token is never sent to the
Mac, and the agent token is never sent to Ollama.

## Mac installation

Keep the agent under `~/.local/share/visionquest/mac-relay/`, outside any worktree.
Its `config.json` must be owner-only (0600), in an owner-only directory (0700):

```json
{
  "relayUrl": "wss://visionquest.onrender.com/__visionquest/local-ai/agent",
  "agentToken": "<dedicated agent token>",
  "upstreamUrl": "http://127.0.0.1:11434"
}
```

Install the pinned `ws` and `zod` dependencies from the source package versions.
Run `node agent.mjs /absolute/path/config.json`. The maintained sources are in
`scripts/mac-relay/`; copy `agent.mjs`, `protocol.mjs`, and `inference-queue.mjs` to the persistent directory.
The LaunchAgent `com.visionquest.mac-relay` runs this command under `caffeinate -i`
to prevent idle sleep while enabled. It restarts on failure and at login. It does
not change global power settings or prevent display sleep. Logging contains only
connection state, never prompts, replies, authorization headers, or tokens.

The Mac must remain powered on and logged in with Ollama running.
Logging out, stopping Ollama, or losing networking
makes Sage unavailable. Cloud fallback stays blocked.

## Boundaries and verification

- Only GET health/tags/version and POST chat/generate/show are allowed.
- Top-level API fields must use canonical lowercase ASCII names. Unicode message
  and tool content is retained. Validated JSON is normalized before native
  forwarding so duplicate fields cannot change interpretation in Ollama.
- Every POST must name `gemma4:12b` or `gemma4:12b-mlx`; pull/delete, embeddings, arbitrary paths, and
  cloud models are refused. The Render adapter and Mac agent independently enforce
  the model boundary; model listings expose only the two approved tags.
- Twelve requests maximum, at most eight background requests, 2 MiB input,
  16 MiB output, bounded socket buffering,
  and a three-minute request deadline. Capacity exhaustion returns an error.
- Tokens are checked before any model data is handled. Rotate both tokens after
  suspected disclosure; update Render and the private agent config together.
- Verify unauthorized WSS access is rejected, both demo roles can receive real
  model replies, and the audit log identifies `ollama` with `allowCloud=false`.
- Stop the Mac agent and verify a new model request fails without a cloud call,
  then restart it and verify reconnect/recovery.

## Stop and rollback

Stop only this connection with:

```sh
launchctl bootout "gui/$(id -u)/com.visionquest.mac-relay"
```

Restart it with `launchctl bootstrap` and its saved plist. Do not remove the model
bridge or any model files. To disable the Render wrapper, set
`VQ_MAC_RELAY_ENABLED=false` and leave the cloud fence enabled. Clear the approved
origin as well: old saved endpoints must not become implicitly trusted. The normal
Next startup resumes; demo model requests remain safely unavailable.

## Interactive priority

The Mac agent admits at most twelve pending requests, including no more than
eight non-streaming background requests. This leaves four slots for interactive
chat and metadata. It forwards one inference at a time. Streaming chat runs
before waiting non-streaming extraction. Extraction initially waits 10 seconds
before becoming eligible, giving the next chat a chance to arrive.

On native Ollama, a new chat cancels an active background computation **only
before response headers have been committed**. The same background request waits
another 10 seconds and can recompute after chat; its caller receives at most one
response. The original 180-second deadline is never extended. Caller cancellation,
disconnects, timeouts, and genuine inference failures are not retried. Committed
responses and other interactive chats are never interrupted. Pure model computation
may repeat; application-side extraction effects occur only after its final result.

Existing installations must change the private config's `upstreamUrl` from port
11436 to `http://127.0.0.1:11434` and reinstall the agent sources. The installer
preserves existing configuration and credentials. Preemption remains disabled
for the older buffering bridge because HTTP cancellation there does not promptly
stop Ollama compute. The embedding bridge can continue running independently;
this change neither routes embeddings through the relay nor changes their model.

Health and metadata bypass inference scheduling. The total admission bound still
applies, so twelve occupied slots can produce a busy response. This is scheduling,
not extra model capacity.
This improves contention after a student reply without disabling discovery,
classroom confirmation, mood, or memory extraction. It does not eliminate the
cost of processing a fresh prompt. Measure first visible text separately from
whole-reply completion, and report uncached and reused-prefix results separately.

## MLX prompt cache (optional local 12B variant)

`VQ_MAC_RELAY_MODEL=gemma4:12b-mlx` selects Ollama's MLX Gemma 4 12B
variant on the same Mac. Omit the setting or use `gemma4:12b` to retain the
original GGUF runner and prompt layout. Other values fail closed. Install the
MLX weights locally and update the persistent agent protocol
before changing Render's setting. The relay accepts only these two local tags;
this does not enable cloud models, model downloads through the relay, or new
embedding models.

For the MLX variant, Sage places shared instructions in the first native system
message, followed by Ollama's tool definitions, then changing student/staff
context in a second system message. Every original prompt section remains
present. The trusted boundary is internal metadata, never supplied by the
browser. Other provider formats continue receiving the entire system prompt.
All generation paths retain usage accounting and the same output limits.

The prefix cache contains model attention state, not saved replies. Ollama must
match the input tokens before reusing it; identity, record context, and questions
are still sent on every turn. Cold starts and cache eviction remain slow. The Render app automatically prepares both demo roles with two different
synthetic conversations at startup and every fifteen minutes. Preparation is
non-streaming, preemptible background work; it never executes tools or stores
conversations. Failed preparation retries after one minute. Relay-backed model
requests use `keep_alive: "-1s"` so overnight idleness does not unload Sage.
After a Mac/model restart, allow initial preparation to complete before opening
a demo; it still requires real Mac computation (about two minutes in the local
2026-10-23 test). Do not
promise warm latency for the first cold request or during active background
inference. The agent still prioritizes waiting interactive requests.

On 2026-10-22, the actual compact discovery prompt plus 33 tools measured locally:
first two synthetic students 70.6/79.7 seconds to first text; third student
4.2 seconds (9.4 seconds complete); different question 7.9 seconds (12.4 complete).
These are individual observations, not a percentile or a hosted acceptance test.

Evaluate the actual layout entirely on the Mac:

```sh
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_NUM_CTX=16384 OLLAMA_AUTH_MODE=none \
  node --import tsx scripts/sage-redteam-eval.mjs --provider=ollama \
  --model=gemma4:12b-mlx --temperature=0 --prompt-layout=mac-cache
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_NUM_CTX=16384 OLLAMA_AUTH_MODE=none \
  node --import tsx scripts/sage-chat-harness.mjs --provider=ollama \
  --model=gemma4:12b-mlx --temperature=0 --prompt-layout=mac-cache \
  --families=tool,guardrail,confirmation --strict
```

Before activation, require passing safety/tool checks and fresh-user timing
through Render. Alternate roles and identities, verify a real read-only tool
continuation, and verify fail-closed behavior while the Mac agent is stopped.
After a Render deploy, reconnect the Mac agent to the new instance before the
hosted checks. Roll back by restoring `VQ_MAC_RELAY_MODEL=gemma4:12b` and
reconnecting after that deploy; no student data or vector index migration occurs.


## Durable demo memory (2026-10-23)

With the Mac relay enabled, saving an assistant message also commits a memory
intent in that message's metadata. A ten-second worker reconciles up to 25 intents
at a time into `BackgroundJob` rows of type `sage_memory`, storing only owner,
conversation and source-message IDs. An enqueue failure or Render restart leaves
the intent available for recovery. This path replaces immediate student/staff
memory fan-out; discovery, goals, classroom confirmation and mood keep their
existing behavior. The per-turn fan-out cap does not discard queued memory;
the daily memory ceiling still applies (200 per account by default).

One memory job runs at a time across processes, with a five-minute database
lease and a thirty-second heartbeat. The write checks and locks that lease so
an old attempt cannot save memories after reclamation. Busy/outage/invalid-output
failures stay pending with exponential retry from thirty seconds to fifteen
minutes. Jobs beyond the 24-hour recovery window become visibly failed. Daily
ceiling skips are recorded as failed with a specific no-inference reason rather
than blocking other accounts' admission. The general job processor excludes
this type; the app's worker owns its scheduling. `SAGE_MEMORY_ENABLED=false`
stops new intents and processing. Keep the relay/local-only guards enabled while
draining work.

Local-only deployments save pseudonymized memories without embeddings and use
owner-scoped keyword/confidence/recency retrieval. Exact-content and suppressed
memory dedupe remains; semantic-vector dedupe is unavailable in this mode.
Existing vectors and their model provenance are unchanged. Re-enabling vector
memory later requires a separate backfill decision for unembedded rows.
No cloud inference or embedding call is required for this memory path.

Operator checks (aggregate only; do not print job payloads or memory content):

```sql
SELECT status, count(*), max(attempts) AS max_attempts,
       min("createdAt") AS oldest
FROM visionquest."BackgroundJob" WHERE type = 'sage_memory'
GROUP BY status;
```

For acceptance, run consecutive synthetic student/staff chats, wait for their
memory jobs to drain, and verify saved memories are usable by their owner only.
Stop/reconnect the Mac agent during an extraction and verify automatic retry
without cloud fallback. Inspect failed jobs rather than treating empty extraction
results as proof of persistence. Rollback retains jobs and message intents;
restoring this worker within its 24-hour recovery window resumes them. Old code's
general job processor does not recognize this job type, so pause job processing
before rolling back to a release older than this worker.
