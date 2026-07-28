# Local AI Implementation Packet for Mac Codex

**Date:** 2026-07-28
**Purpose:** Give a separate Codex running on macOS the complete, non-secret
repository context needed to implement and review VisionQuest's Windows
Ollama, relay, Cloudflare, and provider-routing setup.

This packet contains names, paths, behavior, ports, and operational
assumptions only. It contains no credential values, environment-file contents,
student records, tunnel credential JSON, private keys, or internal host data.

## Required outcome

VisionQuest production must use:

```text
Render application
  -> Cloudflare Access-protected HTTPS hostname
  -> named Cloudflare Tunnel
  -> Windows cloudflared service
  -> 127.0.0.1:11435 ollama-relay.mjs
  -> 127.0.0.1:11434 Ollama service
  -> pinned local Gemma 4 model
```

Routing policy:

- `student_record` and `staff_entered` requests are FERPA-protected and must
  use local Gemma 4 only.
- A local failure must fail closed. Gemini is not a fallback.
- `public_program` and `system` requests may use Gemini only when the prompt
  contains no protected student or staff-entered content.
- The classification follows the data, not the user's job title or route.

## Canonical operator documentation

Start with:

- [`docs/runbooks/local-ai-windows-cloudflare.md`](../runbooks/local-ai-windows-cloudflare.md)
- [`docs/runbooks/secret-handling.md`](../runbooks/secret-handling.md)
- [`config/cloudflared/config.example.yml`](../../config/cloudflared/config.example.yml)

Historical context remains in:

- [`docs/plans/2026-04-15-local-ai-tunnel-recommendation.md`](../plans/2026-04-15-local-ai-tunnel-recommendation.md)
- [`docs/plans/2026-07-02-local-ai-operator-runbook.md`](../plans/2026-07-02-local-ai-operator-runbook.md)

## Repository-grounded file map

All paths are relative to the repository root.

| Path | Current behavior relevant to this setup |
|---|---|
| `src/lib/ai/provider.ts` | Reads `ai_provider`; constructs Gemini or Ollama; classifies `student_record` and `staff_entered` as local-only sensitivities, but currently returns Gemini when the operator setting is `cloud`. |
| `src/lib/ai/local-config.ts` | Reads local URL, model, embedding model, auth mode, API style, context window, and encrypted/auth environment fallbacks. Default chat model is `gemma4:26b`; default local embedding model is `nomic-embed-text`. |
| `src/lib/ai/local-auth.ts` | Supports `none`, `bearer`, and `cloudflare_service_token`; emits `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers for Cloudflare Access. Missing required auth material throws before a model call. |
| `src/lib/ai/types.ts` | Defines provider, task, sensitivity, authentication, and API-style unions. |
| `src/lib/ai/ollama-provider.ts` | Uses a 300-second generation timeout, 300-second stream connection timeout, 45-second first-content timeout, 8,192 default `num_ctx`, and compact prompts. It supports native Ollama and OpenAI-compatible APIs and retries transient tunnel/startup failures before content is yielded. |
| `src/lib/ai/gemini-provider.ts` | Cloud provider implementation. Model name comes from `src/lib/gemini.ts`; credentials resolve server-side. |
| `src/lib/ai/audit.ts` | Records provider class, sensitivity, policy decision, and call metadata without storing prompt bodies. |
| `src/app/api/chat/send/route.ts` | Teacher staff-role chat is `staff_entered`; student chat is `student_record`. Coordinator chat uses the teacher conversation shape but remains `student_record` for provider routing. Deterministic public blank-form and simple greeting responses can bypass the model. Provider-init failure returns an offline/unavailable response and records a blocked audit event. |
| `src/app/api/chat/warmup/route.ts` | Warms the same `student_record` provider path used by protected chat. |
| `src/app/api/chat/upload/route.ts` | Classifies chat-upload model work as `student_record`. |
| `src/lib/chat/conversation.ts` | Conversation summary calls are `student_record`. |
| `src/lib/chat/post-response.ts` | Post-response extraction/memory work resolves with `student_record`. |
| `src/app/api/admin/ai-provider/route.ts` | Admin-only GET/PUT for provider settings. Validates URL, model/auth/API style, credentials, and context range; stores non-secret settings plainly and secret settings through encrypted config helpers. |
| `src/app/api/admin/ai-provider/test/route.ts` | Tests the saved local config, health, real chat path, installed models, tools, JSON output, and embedding dimensions. Health timeout is 300 seconds. |
| `src/components/teacher/AiProviderPanel.tsx` | Program Setup UI for provider, URL, model, embedding model, auth mode, API style, credentials, `num_ctx`, and capability results. |
| `scripts/ollama-relay.mjs` | Listens on `11435`, forwards to Ollama on `11434`, sends an immediate streaming response plus heartbeats every 25 seconds, and uses a five-minute upstream timeout. |
| `scripts/install-local-ai-services.ps1` | Installs auto-start NSSM services for Ollama and the relay, installs/starts `cloudflared`, configures restart behavior and logs, and smoke-tests ports `11434` and `11435`. |
| `scripts/start-sage-tunnel.bat` | Starts and queries the three installed Windows services; it no longer embeds a user-specific repository path. |
| `scripts/warm-sage-model.ps1` | Windows model warm-up helper used by the existing scheduled-task flow. |
| `config/cloudflared/config.example.yml` | Safe placeholder-only named-tunnel ingress example. The real copy and credential JSON stay outside Git. |
| `.gitignore` / `.dockerignore` | Exclude environment files, private-key formats, and Cloudflare credential/config paths. |
| `.github/workflows/secret-scan.yml` | Downloads a version- and checksum-pinned Gitleaks binary and scans only commits introduced by a push/pull request (or the current manual-run commit) with redacted output. |

## Exact routing behavior today

`src/lib/ai/provider.ts` currently behaves as follows:

1. `getConfiguredProviderType()` returns `local` only when SystemConfig
   `ai_provider` is exactly `local`; otherwise it returns `cloud`.
2. `resolveAiProvider()` identifies `student_record` and `staff_entered` as
   sensitive.
3. For a sensitive request, it returns Ollama when `ai_provider=local`, but
   returns Gemini when `ai_provider=cloud`.
4. For `public_program` plus `preferCloud=true`, it returns Gemini.
5. Other requests follow the globally configured provider.

The comments and `AIProviderRequest.preferCloud` type documentation say
sensitive requests remain local-only, but step 3 is a deliberate alpha-era
escape hatch and contradicts the new production policy.

### Confirmed production enforcement gap

The repository does **not** yet hard-enforce local-only routing for
FERPA-sensitive requests. Production is compliant only while the operator
keeps Program Setup set to **Local AI Server**.

A follow-up production-code change should make
`resolveAiProvider({ sensitivity: "student_record" | "staff_entered" })`
unconditionally call `getLocalProvider()` and fail if local configuration or
connectivity is unavailable. It must not call `getCloudProvider()` for those
sensitivities. Provider tests must be updated so the current
“sensitive + configured cloud → Gemini” case becomes a fail-closed/local-only
assertion.

That code change is intentionally not part of this documentation-focused
packet.

## SystemConfig keys

These are database-backed application settings managed through Program Setup.
Names are safe to document; values are not.

| Key | Allowed/expected content | Storage behavior |
|---|---|---|
| `ai_provider` | `local` or `cloud` | Plain |
| `ai_provider_url` | Loopback URL in development or protected HTTPS tunnel hostname in production | Plain |
| `ai_provider_model` | Exact pinned local Gemma 4 tag | Plain |
| `ai_provider_embedding_model` | `nomic-embed-text` or another validated 768-dimensional model | Plain |
| `ai_provider_auth_mode` | `none`, `bearer`, or `cloudflare_service_token` | Plain |
| `ai_provider_api_style` | `ollama` or `openai` | Plain |
| `ai_provider_num_ctx` | Integer from 1,024 through 131,072; default 8,192 | Plain |
| `ai_provider_api_key` | Optional local endpoint bearer token | Encrypted |
| `ai_provider_cloudflare_access_client_id` | Cloudflare Access service-token client ID | Encrypted |
| `ai_provider_cloudflare_access_client_secret` | Cloudflare Access service-token client secret | Encrypted |

Production should use `local`, the protected HTTPS tunnel hostname,
`gemma4:26b` or another explicitly approved pinned local Gemma 4 tag,
`cloudflare_service_token`, and `ollama`.

## Configuration variable names

Document names only. Never add or copy values.

### Render application

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Permits cloud Gemini calls for approved non-FERPA tasks. |
| `GEMINI_MODEL` | Optional Gemini model override. |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID` | Preferred Cloudflare Access client-ID fallback. |
| `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET` | Preferred Cloudflare Access client-secret fallback. |
| `CF_ACCESS_CLIENT_ID` | Supported shorter client-ID alias. |
| `CF_ACCESS_CLIENT_SECRET` | Supported shorter client-secret alias. |
| `CLOUDFLARE_ACCESS_CLIENT_ID` | Supported legacy client-ID alias. |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Supported legacy client-secret alias. |
| `AI_PROVIDER_API_KEY` | Optional bearer-token fallback for a non-Cloudflare local endpoint. |
| `OLLAMA_API_KEY` | Supported alias for `AI_PROVIDER_API_KEY`. |
| `AI_PROVIDER_EMBEDDING_MODEL` | Optional embedding-model fallback. |
| `AI_PROVIDER_API_STYLE` | Optional `ollama` / `openai` API-style fallback. |
| `SAGE_CAPABILITY_PROBE_TIMEOUT_MS` | Optional capability-probe timeout, 1,000–120,000 ms. |

The local endpoint URL and chat-model selection are SystemConfig values, not
current `OLLAMA_URL`, `OLLAMA_BASE_URL`, or `OLLAMA_MODEL` environment
settings. Do not build a new deployment around those legacy names without a
code change.

### Windows Ollama and relay services

| Variable | Current service value/behavior |
|---|---|
| `OLLAMA_HOST` | Ollama service binds to loopback; relay uses it as upstream and defaults to `http://localhost:11434`. |
| `OLLAMA_MODELS` | Model directory owned by the Windows service account. |
| `OLLAMA_KEEP_ALIVE` | Installer sets model residency behavior. |
| `OLLAMA_NUM_PARALLEL` | Installer sets concurrent inference slots. |
| `OLLAMA_MAX_QUEUE` | Installer sets request queue depth. |
| `RELAY_PORT` | Relay listener; defaults to `11435`. |

## Windows service assumptions

Service names:

- `VisionQuest-Ollama`
- `VisionQuest-OllamaRelay`
- `cloudflared`

Default local endpoints:

- Ollama: `http://127.0.0.1:11434`
- Relay: `http://127.0.0.1:11435`

Default log directory:

```text
C:\ProgramData\VisionQuest\logs
```

Default Cloudflare service configuration:

```text
C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
```

The real tunnel credential JSON lives beside that service configuration. It is
never a repository file. The installer expects `cloudflared.exe` at
`C:\Cloudflared\bin\cloudflared.exe` unless an override parameter is supplied.

NSSM wraps Ollama and the Node relay, configures automatic start, rotates logs,
and restarts on failure. The relay depends on `VisionQuest-Ollama`.
`cloudflared` is an automatic Windows service. Ports `11434` and `11435` stay
on loopback; there is no router port-forward.

## Relay behavior that must remain intact

The relay exists because a cold or CPU-bound model may not produce content
before an edge read timeout:

- It responds to a streaming request immediately.
- It writes SSE comment heartbeats every 25 seconds.
- It forwards the actual Ollama stream transparently.
- It strips incoming Cloudflare headers before forwarding to Ollama.
- It uses a five-minute timeout for both streaming and non-streaming upstream
  work.
- It returns a relay error when the upstream is unavailable.

Cloudflare ingress must point to the relay on `127.0.0.1:11435`, not directly
to Ollama.

## Cloudflare assumptions

- Use a named, locally managed tunnel with a stable dedicated hostname.
- Do not use Quick Tunnels or ephemeral ngrok URLs.
- The configuration has one hostname ingress rule to
  `http://127.0.0.1:11435` and a final `http_status:404` catch-all.
- Protect the hostname with a Cloudflare Access self-hosted application.
- Use a **Service Auth** policy containing one service token.
- Do not add **Allow Everyone** or **Bypass**.
- Store the service-token pair in Render environment variables, preferably
  the `AI_PROVIDER_CLOUDFLARE_ACCESS_*` names.
- Record token expiration and rotate before expiry.

## Implementation order for Mac Codex

1. Read `CLAUDE.md`, `.claude/rules/security.md`, and this packet.
2. Review the listed repository files; do not read environment files or any
   student data.
3. Preserve the documentation/runbook, ignore rules, safe Cloudflare example,
   portable Windows scripts, and secret-scan workflow.
4. If authorized to close the enforcement gap, change only provider routing
   and its focused tests; do not add a cloud fallback.
5. Keep all examples placeholder-only and repository-relative.
6. Run the verification checklist below.
7. Hand Windows-only commands to the Windows operator; do not pretend a macOS
   test validated Windows service installation.

## Verification checklist

Repository-safe checks:

```powershell
git status --short
git diff --stat
git diff --check
gitleaks git --redact --verbose .
gitleaks dir --redact --no-banner .
```

Static checks:

- Parse `scripts/install-local-ai-services.ps1` without executing it.
- Parse `.github/workflows/secret-scan.yml` and
  `config/cloudflared/config.example.yml`.
- Verify `.env*`, Cloudflare credential JSON/config, and private-key formats
  are ignored.
- Verify all new relative Markdown links resolve.
- Search changed paths for machine-specific user names, real hostnames, key
  blocks, and common token prefixes; report paths only.

Windows operator checks:

```powershell
Get-Service VisionQuest-Ollama, VisionQuest-OllamaRelay, cloudflared
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:11435/api/tags -UseBasicParsing
npx tsx scripts/sage-chat-harness.mjs --provider=ollama --strict
```

Application checks:

- Program Setup remains **Local AI Server**.
- Model is the approved pinned local Gemma 4 tag.
- Authentication is **Cloudflare service token**.
- Test Connection validates chat, tools, JSON output, and 768-dimensional
  embeddings.
- A synthetic protected chat fails closed when the tunnel is stopped and does
  not return a Gemini response.
- A synthetic, clearly non-FERPA task may use Gemini.
- No real student data is used for acceptance testing.

## Files intentionally not included

- Any environment file or its contents
- Cloudflare login certificate
- Tunnel credential JSON
- Cloudflare service-token values
- Gemini API key
- Render/Supabase credentials
- Real hostname, tunnel UUID, Windows user name, or internal IP
- Student records, filled forms, database dumps, logs containing identifiers,
  or screenshots
