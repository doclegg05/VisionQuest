# VisionQuest Local AI Tunnel Recommendation

**Created:** 2026-04-15  
**Context:** Internal planning note for future agents

## Situation

VisionQuest was configured to use a locally hosted Ollama instance for Sage through a public `ngrok-free.dev` URL stored in `ai_provider_url`.

The immediate question was whether Render, Sage, or the Ollama provider code was broken, or whether the problem lived at the tunnel layer.

## Relevant Facts Already Established

- Ollama on the local host responded successfully to `http://localhost:11434/api/tags` with `200 OK`.
- The public ngrok URL returned `403 Forbidden` for `GET /api/tags`, even when the request included:
  - `ngrok-skip-browser-warning: 1`
  - a non-browser `User-Agent`
- Render-side Sage failures were therefore downstream of a public tunnel that never forwarded requests cleanly to Ollama.
- The repo’s local AI architecture docs already recommended Cloudflare Tunnel as the practical production path for multi-classroom use.

## Root Cause Interpretation

The observed failure is at the **public tunnel / tunnel-provider edge**, not in:

- Render deployment
- Sage chat route logic
- Ollama itself
- the local machine’s Ollama listener

Future agents should treat a reproducible `localhost = 200` plus `public tunnel = 403/502` pattern as a tunnel/provider problem first.

## Recommended Position

Do **not** use `ngrok free` as the production Sage endpoint from Render.

Treat it as a short-lived developer convenience only. For any real hosted Sage traffic, the preferred path is:

1. dedicated always-on Ollama host
2. stable Cloudflare Tunnel hostname such as `llm.<domain>`
3. Cloudflare Access service-token protection for app-to-app traffic

## What Future Agents Should Say

If asked for the best practical path, future agents should say:

> Ollama is healthy locally, but the public ngrok free endpoint is blocking or failing requests before they reach the model host. The practical production path is to move Sage local AI traffic to a stable Cloudflare Tunnel hostname on a dedicated always-on host, not to keep iterating on ngrok free.

## What Future Agents Should Do

- Verify the split explicitly:
  - local Ollama endpoint
  - public tunnel endpoint
- Preserve the current finding instead of restarting the same ngrok debugging loop.
- Recommend Cloudflare Tunnel for production local AI traffic.
- Prefer service-token-authenticated Cloudflare Access headers over unauthenticated public exposure.
- Keep connection tests aligned with real Sage request behavior, including auth headers and actual chat-path validation.

## What Future Agents Should Avoid

- Do not describe `ngrok free` as production-ready for Sage.
- Do not assume a passing localhost Ollama check means the public endpoint is valid.
- Do not rely on a shallow `GET /api/tags` check alone when validating a local AI endpoint.
- Do not point Render-hosted Sage traffic at an ephemeral ngrok URL unless the work is explicitly dev-only and disposable.

## Bottom Line

The problem is **not** that Ollama failed to run locally. The problem is that the public tunnel selected for Sage was not a reliable production path. The standing recommendation is to use **Cloudflare Tunnel on a dedicated always-on host** for VisionQuest local AI traffic.
