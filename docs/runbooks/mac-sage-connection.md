# VisionQuest Render-to-Mac connection

The Mac initiates an authenticated WSS connection to the existing VisionQuest web
service. No Mac port is publicly exposed, and no DNS, new hosting service, tunnel
account, or historical LeggAI credentials are involved. Inference remains on the
Mac's `gemma4:12b` through the existing loopback bridge at port 11436.

```text
Browser → existing Render HTTPS app → authenticated loopback adapter :11437
                                        ↕ authenticated WSS
                               Mac agent → 127.0.0.1:11436 → Ollama
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
  "upstreamUrl": "http://127.0.0.1:11436"
}
```

Install the pinned `ws` and `zod` dependencies from the source package versions.
Run `node agent.mjs /absolute/path/config.json`. The maintained sources are in
`scripts/mac-relay/`; copy `agent.mjs` and `protocol.mjs` to the persistent directory.
The LaunchAgent `com.visionquest.mac-relay` runs this command under `caffeinate -i`
to prevent idle sleep while enabled. It restarts on failure and at login. It does
not change global power settings or prevent display sleep. Logging contains only
connection state, never prompts, replies, authorization headers, or tokens.

The Mac must remain powered on and logged in; the existing model bridge also runs
as a per-user LaunchAgent. Logging out, stopping the bridge, or losing networking
makes Sage unavailable. Cloud fallback stays blocked.

## Boundaries and verification

- Only GET health/tags/version and POST chat/generate/show are allowed.
- Every POST must name `gemma4:12b`; pull/delete, embeddings, arbitrary paths, and
  cloud models are refused. The bridge and agent both enforce the model boundary.
- Four requests maximum, 2 MiB input, 16 MiB output, bounded socket buffering,
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
