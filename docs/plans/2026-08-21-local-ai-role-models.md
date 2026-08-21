# Which local model should serve which role

**Date**: 2026-08-21
**Status**: capability shipped; **the model picks are not yet made** — they need one bake-off run on the real host
**Supersedes nothing.** Extends `docs/plans/2026-07-02-local-model-acceptance-report.md`, whose verdict ("NO-GO for this specific configuration, pending a hardware/config check") has never been revisited with a full run.

---

## 1. The question, stated honestly

"What is the best local AI for VisionQuest?" has no single answer, because VisionQuest does not ask a local model to do one thing. It asks for four things that fail in different ways:

| Role | What it does | What actually decides success |
|---|---|---|
| `chat` | The student's coaching turn — streaming, tool-calling, ~20k-char prompt | Emits a **well-formed tool call** against a 19-tool registry, and writes at a 6th-grade reading level. A dropped or malformed call returns an **empty turn**, not an error. |
| `extract` | Goals, career discovery, mood, classroom, memory — strict JSON over a short transcript, in the background | **JSON-mode conformance.** Failures here are silent: on 2026-08-20 memory extraction stored 0 of 20 memories with zero errors, because `json_object` mode cannot emit the bare array the prompt asked for. |
| `document` | Resume parse, attachment classification — a long messy document to conforming JSON | **Long-input handling plus output headroom.** A whole resume object does not fit in the 512-token structured cap; a truncated parse is indistinguishable from "no data". |
| `draft` | Cover letters, tailored applications, briefings, conversation summaries | **Sustained non-degenerate prose.** A looping model reads as fluent and passes every length check. |

Before this work, all four shared one `ai_provider_model`. Choosing per role was not a decision anyone could make — there was no place to put the answer.

## 2. What shipped (and what did not)

**Shipped — the capability:**

- `src/lib/ai/roles.ts` — the four roles, each with the discriminator above, and a total map from the `AiTask` every call site already declares. All 11 `resolveAiProvider` call sites are role-routed with no call-site edits.
- Per-role model: `ai_provider_model_{chat,extract,document,draft}` (env fallback `AI_PROVIDER_MODEL_CHAT`, …). Unset → the global model, i.e. today's behavior exactly.
- Per-role output cap: `ai_provider_max_output_tokens_{role}`. Unlike the global cap, this one reaches JSON mode.
- Residency guard: a role resolving to a **different** model than `chat` gets a short keep-alive, on the surface that actually applies it.
- `npm run sage:model:bakeoff -- --models=a,b,c` — deterministic scoring of every role against every candidate.
- `--model=` on `scripts/lib/sage-eval-provider.mjs`, which every model-driving eval resolves through, so `sage:quality:eval`, `sage:agent:eval`, `sage:redteam:eval`, `sage:memory:eval` and `sage:chat:harness` all gained it at once.
- The usage ledger now records the **model tag**, not `"ollama"`. Without this the split would have been unmeasurable the moment it shipped.

**Not shipped — the answer.** No model is assigned to any role. Every role still resolves to `ai_provider_model`. That is deliberate: see §3.

## 3. Why there is no recommendation yet

The evidence base is far thinner than the confidence around it. Consolidating everything measured on a local model in this repo's history:

| What | Number | Source |
|---|---|---|
| `gemma4:latest` reply quality after #149 | 8/8 replies, avg FK 5.1, 0/8 over grade-8 | commit `6c8d037` |
| `gemma4:26b-a4b-it-qat` reasoning ON vs OFF @768 | 0 chars / 42.9s vs 241–443 chars / 21.3s | commit `eb26560` |
| Same model, reasoning ON @3072 vs OFF @768 | 1/8 in 2223s (7/8 hit the 300s cap) vs 7/8 in 159s | commit `1116ea2` |
| Undeclared-tool drop | 10/10 empty vs 10/10 prose control | commit `6c8d037` |
| Memory extraction, local FERPA path | 0 of 20 stored, 0 errors → 19–20/20 after the unwrap fix | commit `aa46169` |
| Single-call latency, 20k-char synthetic prompt | ~20–21s/reply | `scripts/sage-load-test.mjs` |
| Residency | 26b = 15 GB, latest = 9.6 GB; they do not co-reside | `.claude/MEMORY.md` |
| Gemini comparator | p50 1283ms / p95 1816ms | `config/sage-slo.json` |

And what is **not** known:

- **No local model has ever been scored on tool selection, red-team boundaries, or grounding.** The 2026-07-02 acceptance report attempted 4 of 18 chat-harness cases and scored zero; red-team (28 scenarios) and agent tool-selection (45 scenarios) were not run for either provider. Its own summary: *"almost nothing was actually measured for the local model."* **The single capability that most decides the `chat` role has never been measured on any local model.**
- **Only two models have ever been tested at all** — `gemma4:latest` and `gemma4:26b-a4b-it-qat`. Everything else in the docs is a compatibility list, not a result.
- **The host of every measurement since 2026-07-27 is unrecorded**, and the numbers are mutually inconsistent (3.2 tok/s in July vs ~10 tok/s in April on nominally the same setup; ~70s/220 tokens vs ~20s). The only always-on host on record is a Windows i5-13500T / 32 GB / Intel UHD 770 with `size_vram: 0` — CPU-only.
- **The 15-student "9.0 min p50" figure is a projection, not a run** (`classroomSize × measured p50`), and its premise is wrong: the load test asserts nothing sets `OLLAMA_NUM_PARALLEL`, but `scripts/install-local-ai-services.ps1` — the installer this repo ships — sets it to 4 with `OLLAMA_MAX_QUEUE=100`. On a host provisioned the shipped way there are 4 parallel slots, not strict FIFO. Re-measure before this number drives a queueing decision.

**So: the four-role taxonomy is a hypothesis derived from failure forensics, not from comparative measurement. Any "best model per role" claim made today would be taste.** The bake-off exists so the next version of this section can be numbers.

## 4. Candidate slate for Apple Silicon

The intended host is a Mac Studio (Apple Silicon, unified memory). Note the repo does not yet record this machine — `INTEGRATIONS.md` still calls Ollama "Dormant" and the Mac Studio appears as a purchase proposal — so **record the actual chip and RAM in `.claude/MEMORY.md` when the first bake-off runs.** Every number in §3 is uninterpretable without it, and that is precisely the mistake this corpus already made.

Two Apple-Silicon-specific facts change the slate:

1. **Ollama runs on MLX on Apple Silicon** (32 GB+ unified memory), worth roughly 15–30% throughput and ~10% less memory versus the llama.cpp path. Prefer the `-mlx` tags — `gemma4:12b-mlx`, `gemma4:e4b-mlx` — and include both a `-mlx` and a non-`mlx` arm of the same model in the first bake-off to measure the delta on this box rather than trusting the range.
2. **`OLLAMA_NUM_PARALLEL` is the concurrency knob**, and the shipped installer sets 4. Unified memory shows up as tail latency under concurrency, so the classroom question is a p95 question, not a p50 one.

Gemma 4 ships in five sizes: E2B, E4B, 12B Unified, 26B-A4B (MoE, ~3.8B active), 31B Dense. The 26B-A4B is the interesting one — MoE means it runs at roughly 4B-active speed with much larger-model quality, and it is already the repo's default.

Suggested first bake-off:

```bash
# Confirm every candidate is installed before burning an hour on arms that will 404.
npm run sage:model:bakeoff -- --models=gemma4:26b-a4b-it-qat,gemma4:12b-mlx,gemma4:e4b-mlx --warmup-only

# The real run. Eviction between arms is on by default and must stay on.
npm run sage:model:bakeoff -- \
  --models=gemma4:26b-a4b-it-qat,gemma4:12b-mlx,gemma4:e4b-mlx \
  --repeats=3 --json-out=reports/bakeoff-2026-08-21.json
```

Then the cap-bound question separately — same models, raised budget. If a role's failures move from `requiredFields`/`parsesAsJson` to passing when the cap rises, the problem was never the model:

```bash
npm run sage:model:bakeoff -- --models=... --roles=document,draft --max-output-tokens=2048
```

And the two chat-role capabilities the bake-off deliberately does not duplicate, now that `--model=` exists:

```bash
npm run sage:agent:eval   -- --provider=ollama --model=gemma4:26b-a4b-it-qat --min-accuracy=75
npm run sage:redteam:eval -- --provider=ollama --model=gemma4:26b-a4b-it-qat
```

**Prior expectations, to be falsified rather than trusted:** the 26B-A4B MoE wins `chat` on tool-calling; a 4B-class model is sufficient for `extract` and much cheaper; `document` is cap-bound rather than model-bound; `draft` needs headroom more than intelligence.

## 5. The rule that constrains every answer

**The number of DISTINCT models is the memory budget, not the number of roles.**

Ollama keeps every model it has served resident. Four roles on four models is four standing claims on unified memory, and the two models already in use (15 GB and 9.6 GB) do not co-reside — requests stall swapping. On 2026-07-27 exactly this starvation pushed one model's calls into the 300s timeout and produced a **confidently wrong** A/B conclusion that only reversed once the models were evicted between arms.

So the expected good outcome is **two distinct models, not four**: one for `chat`, one smaller one shared by `extract` + `document` + `draft`. Three roles pointing at one model is a legitimate result, and the fallback makes it the zero-config default.

The residency guard helps but does not remove the constraint. It also carries a caveat worth stating plainly, because the repo has been bitten by this exact shape before: `keep_alive` is a native-`/api/chat` parameter and Ollama's OpenAI-compatible `/v1` endpoint **silently ignores it** ([ollama/ollama#11458](https://github.com/ollama/ollama/issues/11458)). Since the provider prefers `/v1`, a keep-alive written only into the native body never reaches the server — which is how the first version of this feature shipped. An instance given an explicit keep-alive is now pinned to the native surface. **This also means the pre-existing `8h` default has never reached a stock Ollama**: residency has always been governed by the host's `OLLAMA_KEEP_ALIVE`, which the shipped installer sets to 30m, uniformly, for every model. Set it deliberately on the Mac.

## 6. Known hazards for whoever runs this

1. **Evict between arms or the result inverts.** Default-on in the bake-off; `--no-evict` only for deliberate co-residency measurement. Verify with `/api/ps`.
2. **The FERPA switch and the embedding model are the same switch.** `resolveEmbeddingProvider` keys off the same `ai_provider` value as chat. Flipping cloud→local also swaps `gemini-embedding-001` → `nomic-embed-text`, which invalidates every stored vector via the `query_model` guard. RAG degrades to its FTS leg; **Sage memory goes fully dark** — `retrieveMemories` has no keyword fallback and returns `[]` with only a warning. Run `npm run sage:rag:backfill -- --reembed` as part of that flip, not after someone notices.
3. **FERPA currently fails *open*, not closed.** If `ai_provider` is anything other than `"local"` — including unset — `student_record` and `staff_entered` go to Gemini with no refusal. It is deliberate and pinned by a test, but it means a mis-set switch is silent. The dev run of `sage:ai:accountability` found 57/57 `student_record` calls cloud-routed. **Run it against prod.**
4. **`ai_provider_num_ctx` may be a no-op on the live path.** It is sent as a bare top-level key in the OpenAI body, where it is not an OpenAI parameter, and `/v1` drops foreign params. Worth a five-minute curl before sizing the `document` role's context on top of it. The output caps do *not* have this problem — `max_tokens` and `num_predict` are both legitimate on their respective surfaces.
5. **Any concurrency measurement must vary the prompt prefix.** An early load-test version returned the second request in 1.3s against a 24.9s cold baseline — pure KV prefix-cache reuse, not throughput.
6. **A LAN-hosted model cannot be configured.** `isSafeAiProviderUrl` allows loopback or a public address only; RFC1918 is rejected. The Cloudflare tunnel is not a preference, it is the only legal non-loopback shape.

## 7. What to do next, in order

1. **Record the host** (chip, unified memory, Ollama version, `OLLAMA_NUM_PARALLEL`, `OLLAMA_KEEP_ALIVE`) in `.claude/MEMORY.md`. Nothing else here is interpretable without it.
2. Run the bake-off in §4 and commit the `--json-out` artifact under `reports/`. No local-model number in this repo's history has a committed artifact; that is why §3 is full of contradictions.
3. Run `sage:agent:eval` and `sage:redteam:eval` against the top-1 or top-2 `chat` candidates. Tool selection and boundary behavior are what the `chat` role lives on and have never been measured locally.
4. Set the two or three config values the results imply. No deploy needed — they are SystemConfig rows.
5. Re-run the classroom load test with the installer's real `OLLAMA_NUM_PARALLEL=4`, and with two distinct models resident, before deciding between more parallel slots and a queue-with-feedback UX.
6. Replace §3 and §4 of this document with the measurements.
