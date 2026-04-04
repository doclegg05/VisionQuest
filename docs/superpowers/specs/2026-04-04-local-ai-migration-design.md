# Local AI Migration Design — Gemma 4 on Mac Studio

**Status:** Approved  
**Date:** 2026-04-04  
**Author:** Britt Legg + Claude  
**Hardware ETA:** ~June 2026

---

## Summary

Replace VisionQuest's dependency on the Google Gemini API with a locally-hosted open model (Gemma 4 26B A4B) running on a Mac Studio M4 Max in the classroom. The Next.js app stays on Render.com; only AI inference calls route to the local server via Cloudflare Tunnel. Both providers (local Ollama and cloud Gemini) remain configurable via admin toggle, with the local server as the primary and Gemini as a rollback option.

## Goals

1. Eliminate recurring AI API costs — one-time hardware purchase replaces yearly API subscription
2. Keep student data local — AI conversations processed on-premises, not sent to Google
3. Serve 15-30+ concurrent users across multiple classrooms (same building + remote sites)
4. Maintain flexibility to swap models, upgrade inference servers, or revert to cloud

## Non-Goals

- Moving the entire Next.js app off Render.com
- Supporting home/off-campus AI access (students get "Sage is offline" outside school network)
- Building a cloud fallback for downtime (friendly offline message instead)

---

## Hardware

**Mac Studio M4 Max**
- 128GB unified memory
- M4 Max chip: 16-core CPU, 40-core GPU
- 1TB SSD storage
- Estimated cost: ~$3,500-4,000 (one-time)

**Why 128GB:** The Gemma 4 26B A4B model uses ~28GB at Q8 quantization. 128GB leaves ~100GB free for: OS overhead, multiple concurrent KV caches (inference slots), potential second model loaded simultaneously, future larger models, and normal desktop use by the classroom instructor.

**Why M4 Max (not Ultra):** The M4 Max at ~$3,500-4,000 delivers ~80-85 tokens/sec single-user and handles 30+ concurrent users. The Ultra ($6,000-7,000) doubles throughput but costs $2,500+ more. For VisionQuest's workload, the Max is sufficient with growth headroom. The upgrade path if needed is software (switch Ollama to vllm-mlx for better batching), not hardware.

**Dual-use:** The Mac Studio serves as a normal desktop computer for the instructor. Ollama runs as a background service using ~36GB RAM and GPU in short bursts. 90+ GB RAM and 14+ CPU cores remain available for office work, browsing, video calls, and other tasks.

---

## Model

**Primary: Gemma 4 26B A4B (Mixture-of-Experts)**
- 25.2B total parameters, 3.8B active per inference
- Q8 quantization: ~28GB RAM, near-lossless quality
- 256K token context window
- Apache 2.0 license — unrestricted educational/institutional use
- Native system instructions, streaming, structured JSON output, reasoning mode

**Why MoE over Dense 31B:** The 26B A4B activates only 3.8B parameters per token (vs 30.7B for the dense model), delivering 3-4x higher throughput at a 2-3 percentage point benchmark tradeoff. For conversational coaching and structured extraction tasks, the quality difference is imperceptible. The throughput gain directly translates to serving more concurrent students with lower latency.

**Why Gemma 4 over alternatives (Qwen 3.5, Llama 4, Mistral):**
- Best MoE efficiency ratio (3.8B active / 25.2B total) among sub-35B models
- Day-one Apple Silicon MLX optimization via Ollama
- Apache 2.0 (Llama 4 has Meta's restrictive license)
- Most current training data (released April 2, 2026)

**Model is swappable.** Ollama abstracts the model behind an OpenAI-compatible API. Changing models is `ollama pull <model>` + one admin config change. No code changes required. Recommend testing 3-4 models (Gemma 4, Qwen 3.5, Llama 4, Mistral) with real Sage prompts before going live.

**Benchmark comparison vs current model (Gemini 2.5 Flash Lite):**

| Benchmark | Gemma 4 26B A4B | Gemini 2.5 Flash Lite |
|-----------|-----------------|----------------------|
| MMLU Pro | 82.6% | Below full Flash (~75-80% est.) |
| GPQA Diamond | 82.3% | Below full Flash |
| Structured JSON | Grammar-constrained (guaranteed valid) | Model-dependent (sometimes wraps in markdown) |
| Context window | 256K tokens | 1M tokens (but VisionQuest uses ~2-4K) |
| System instructions | Native `system` role | `systemInstruction` at model level |

Gemma 4 26B A4B is an upgrade over Flash Lite, not a compromise.

---

## Network Architecture

**Topology: Hybrid — App on Render, AI calls route to Mac Studio**

```
Students (any classroom)
    --> Browser hits Render.com (VisionQuest Next.js app)
        --> API route checks provider config
            |-- Provider = "local"
            |       --> HTTPS request to llm.yourdomain.com
            |               --> Cloudflare Edge (nearest PoP)
            |               --> Cloudflare Tunnel (outbound from Mac Studio)
            |               --> Ollama on Mac Studio (localhost:11434)
            |
            |-- Provider = "cloud"
                    --> Gemini API (existing path)
```

**Cloudflare Tunnel (free, zero IT involvement):**
- `cloudflared` daemon runs on Mac Studio, establishes outbound HTTPS connection to Cloudflare
- Exposes `llm.yourdomain.com` pointing at Ollama (port 11434)
- Works through any school firewall — outbound-only on port 443
- No router changes, no port forwarding, no IT requests
- Cloudflare Access Service Token restricts access to Render's requests only

**Latency:**
- Same-building students: ~20-80ms tunnel overhead + inference time
- Remote-site students: ~50-150ms tunnel overhead + inference time
- Streaming SSE mitigates perceived latency — tokens arrive progressively

**Bandwidth:** AI text streaming uses ~5 Kbps per active student response. 30 concurrent streams = ~150 Kbps. Well within 20-25 Mbps upload capacity (133x headroom).

**When Mac Studio is unreachable:**
- Health check (`GET /api/tags`, 2-second timeout) before each AI call
- If unhealthy: return friendly "Sage is offline right now" message
- All other VisionQuest features (goals, files, orientation, teacher dashboard) work normally

---

## Software Architecture

### Provider Abstraction

New file structure:
```
src/lib/
  ai/
    provider.ts          -- AIProvider interface + getProvider() factory
    ollama-provider.ts   -- Ollama/OpenAI-compatible implementation
    gemini-provider.ts   -- Existing Gemini logic, moved here
    health.ts            -- Health check for local server
  gemini.ts              -- Thin re-export for backward compat during migration
```

**AIProvider interface:**
```typescript
interface AIProvider {
  generateResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string>;
  streamResponse(systemPrompt: string, messages: ChatMessage[]): AsyncGenerator<string>;
  generateStructuredResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string>;
}
```

**Provider resolution:**
1. Admin sets `ai_provider` in SystemConfig: `"local"` or `"cloud"`
2. `getProvider()` reads config, returns `OllamaProvider` or `GeminiProvider`
3. If `"local"`: OllamaProvider checks health first; if unhealthy, throws (caller shows offline message)
4. If `"cloud"`: GeminiProvider uses existing API key resolution chain

### Ollama Provider — API Mapping

| Current (Gemini SDK) | New (Ollama OpenAI-compatible) |
|----------------------|-------------------------------|
| `systemInstruction` in model config | `{ role: "system", content: "..." }` in messages array |
| `responseMimeType: "application/json"` | `response_format: { type: "json_object" }` |
| `sendMessageStream()` | `stream: true` in fetch to `/v1/chat/completions` |
| `chat.sendMessage()` | `stream: false` in fetch to `/v1/chat/completions` |
| Google API key | No authentication (Service Token is at tunnel level) |

### Call Sites to Migrate

| File | Function | Provider Method |
|------|----------|-----------------|
| `src/app/api/chat/send/route.ts` | Chat streaming | `provider.streamResponse()` |
| `src/lib/sage/goal-extractor.ts` | Goal extraction | `provider.generateStructuredResponse()` |
| `src/lib/sage/mood-extractor.ts` | Mood extraction | `provider.generateResponse()` |
| `src/lib/sage/discovery-extractor.ts` | Discovery signals | `provider.generateStructuredResponse()` |
| `src/lib/resume-extract.ts` | Resume parsing | `provider.generateResponse()` |
| `src/lib/resume-ai.ts` | Resume analysis | `provider.generateResponse()` |
| `src/lib/chat/summarizer.ts` | Conversation summary | `provider.generateResponse()` |

### Admin UI Addition

New section in Program Setup (existing admin settings page):
- **AI Provider toggle:** "Local AI Server" / "Google Gemini Cloud"
- **If Local:** Server URL input (pre-filled with Cloudflare Tunnel URL), connection test button showing status (connected/model loaded/error)
- **If Cloud:** Existing API key input (already built)
- Stored in SystemConfig table (existing pattern)

---

## Mac Studio Operations

### Initial Setup (one-time)

1. Install Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull model: `ollama pull gemma4:26b`
3. Configure environment:
   - `OLLAMA_HOST=0.0.0.0` (accept network connections)
   - `OLLAMA_NUM_PARALLEL=4` (4 concurrent inference slots)
   - `OLLAMA_MAX_QUEUE=100` (queue depth before rejecting)
   - `OLLAMA_KEEP_ALIVE=30m` (keep model in memory between requests)
4. Install Cloudflare Tunnel:
   - `brew install cloudflared`
   - Create named tunnel and DNS route
   - Configure Cloudflare Access Service Token
5. Configure auto-start via `launchd` for both Ollama and cloudflared
6. macOS settings: auto power-on after failure, prevent sleep

### Ongoing Maintenance

| Task | Frequency | Effort |
|------|-----------|--------|
| Model updates | Quarterly | `ollama pull gemma4:26b` (one command) |
| Ollama updates | Monthly | `brew upgrade ollama` (one command) |
| macOS updates | Monthly | Standard system update process |
| Verify after power outage | As needed | Check that services restarted (auto-recovery handles most cases) |

### Monitoring

- VisionQuest admin panel shows connection status (green/red indicator)
- Ollama logs to stdout (captured by launchd)
- Cloudflare dashboard shows tunnel health and request metrics

---

## Phased Rollout

### Phase 1: Now through June (no hardware needed)

- Build provider abstraction (AIProvider interface, OllamaProvider, GeminiProvider)
- Migrate all call sites from direct Gemini SDK to provider pattern
- Add admin UI toggle for provider selection
- Add health check and "Sage is offline" message
- Ship to production — everything runs on Gemini exactly as today
- All code is testable against any local Ollama instance for development

### Phase 2: Mac Studio Arrives (~June 2026)

- Set up Ollama + Gemma 4 26B A4B on Mac Studio
- Set up Cloudflare Tunnel with Access Service Token
- Test with a small group of students in the instructor's classroom
- Run side-by-side quality comparison: same 20-30 Sage prompts through both providers
- Test concurrent load with multiple students

### Phase 3: Go Live

- Flip admin toggle from "cloud" to "local"
- Monitor performance, latency, and student experience
- Gemini config remains as instant rollback option
- Test with remote-site classrooms to verify tunnel performance

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Mac Studio hardware not approved | Medium | Blocks Phase 2-3 | Phase 1 code ships regardless; Gemini continues working. Zero wasted effort. |
| Model quality insufficient for Sage | Low | Degraded coaching experience | Side-by-side testing in Phase 2 before go-live. Model is swappable in minutes. |
| School network blocks tunnel | Very Low | Local AI unreachable | Cloudflare Tunnel uses outbound 443 (HTTPS). Virtually never blocked. |
| Mac Studio power/crash during school day | Low-Medium | Sage temporarily offline | Auto-restart via launchd. UPS recommended. Friendly offline message shown to students. |
| Concurrent users exceed capacity | Low | Slow responses | Switch from Ollama to vllm-mlx (software change, same hardware). Or load the lighter 26B A4B MoE (already the default). |
| Gemma 4 superseded by better model | Certain (over time) | N/A | Model is swappable: `ollama pull <new-model>` + config change. Architecture is model-agnostic. |

---

## Cost Summary

| Item | Cost | Frequency |
|------|------|-----------|
| Mac Studio M4 Max 128GB | ~$3,500-4,000 | One-time |
| Gemma 4 model | Free (Apache 2.0) | Free |
| Ollama | Free (open source) | Free |
| Cloudflare Tunnel | Free (free tier) | Free |
| Cloudflare Access | Free (free tier) | Free |
| Electricity | ~$5-10/month | Monthly |
| **Total Year 1** | **~$3,600-4,100** | |
| **Total Year 2+** | **~$60-120/year** (electricity only) | |

vs. Gemini API (estimated for production use with 15-30 concurrent students): $300-1,200/year depending on usage tier.

**Break-even: ~3-5 years**, but the local setup provides: data locality, no rate limits, no API deprecation risk, model flexibility, and zero recurring cost.

---

## Success Criteria

- [ ] Provider abstraction supports both Ollama and Gemini with zero call-site changes
- [ ] Admin can switch providers via UI toggle without redeploying
- [ ] Local provider serves 20+ concurrent Sage conversations at <4 second time-to-first-token
- [ ] Structured JSON extraction (goals, mood, discovery) works reliably with grammar constraints
- [ ] Remote-site classrooms can reach the Mac Studio through Cloudflare Tunnel
- [ ] "Sage is offline" message displays gracefully when Mac Studio is unreachable
- [ ] Side-by-side quality test passes: Gemma 4 output is comparable or better than Gemini Flash Lite for Sage use cases
