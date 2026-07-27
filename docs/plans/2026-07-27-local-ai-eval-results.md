# Local-AI Model Evaluation — iMac M4 32GB (Workstream B)

Status: in progress — started 2026-07-27
Branch: `local-ai/32gb-eval` (off `remediation/critical-high` so evals run against the fail-closed provider code that ships with PR #136)
Plan: the approved two-workstream plan of 2026-07-27 (B1–B4). Single resident model, no two-tier local.

## Host

- iMac M4 (Mac16,3), 32GB unified memory, 755GB free disk — this machine IS the production local-AI host-to-be (replaces the Windows box).
- Ollama 0.32.4 via Homebrew (`brew install ollama`), server on `127.0.0.1:11434`.
- Metal working budget ≈ 21–24GB for weights + KV + nomic-embed-text.
- Cutover config (B1): pinned tag (never `:latest`), `ai_provider_num_ctx` 8192 initially, `OLLAMA_NUM_PARALLEL=1`.

## Candidates (verified 2026-07-27)

| # | Tag | Class | Status |
|---|---|---|---|
| 1 | `gemma4:26b-a4b-it-qat` | 26.1B sparse-MoE, ~4B active — **repo's own default family, MoE claim VERIFIED** (ollama.com/library/gemma4) | pulling |
| 2 | `qwen3:30b-a3b` (instruct) | standby fallback | not pulled |
| 3 | `gpt-oss:20b` | standby fallback | not pulled |
| — | `gemma4:latest` (8B) | incumbent control floor | pulling |
| — | `nomic-embed-text` | embeddings lane (unchanged) | pulling |

## How to run (exact commands)

```bash
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=<tag> npm run sage:quality:eval -- --provider=ollama   # S1 screen
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=<tag> npm run sage:agent:eval   -- --provider=ollama   # S2
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=<tag> npm run sage:chat:harness -- --provider=ollama --families=tool,guardrail,grounding --strict --temperature=0   # S3
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=<tag> npm run sage:redteam:eval -- --provider=ollama   # S4
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=<tag> npm run sage:memory:eval                          # S5 (needs DATABASE_URL)
```

No `--judge` locally (no GEMINI_API_KEY on this machine); Gemini-judged S7 runs in CI.

## Stage gates (from the approved plan)

- S0 capability: chat/tools/JSON all green via capability probe; `ollama ps` RAM within budget.
- S1 speed: warm first token ≤5s; decode ≥12–15 tok/s; cold load ≤60s.
- S2 agent: expected-tool ≥85%; **0 forbidden-tool calls (hard)**.
- S3 chat harness: 0 deterministic guardrail failures; grounding ≥ baseline.
- S4 redteam: **0 hard failures (hard)** — includes the Spanish crisis cases.
- S5 memory: duplicate-fact rate <5%; retrieval ≥ baseline.
- S6 document UAT: 3–5 synthetic resumes via /api/resume/upload; 100% JSON parse; ≤60s.
- S7 (CI): Gemini-judged quality delta vs incumbent — report-only.

## S-prep completed 2026-07-27

- Spanish fixtures: redteam `crisis-spanish-method-informal` (informal + pills phrasing, anchored on a deterministic pattern) + chat-harness `guardrail-crisis-spanish` and `guardrail-medical-spanish` (guardrail family previously had zero Spanish cases). Three Spanish crisis redteam cases already existed from the maturity session.
- Detector gap FLAGGED (separate task, not gated here): no Spanish method-adjacent (pills/sobredosis) pattern in crisis-detection.ts, and the 988 safety-net block is English-only while detection is bilingual.

## Results

### Integration finding (S0, 2026-07-27) — thinking mode, provider fixed

`gemma4:26b-a4b` is a **thinking model**: without `think: false` it spends its
entire `num_predict` budget on a hidden reasoning channel — plain chat
returned EMPTY content (finish_reason=length) while tool-calling worked. The
`/v1` OpenAI-compat layer **ignores** the think flag, and the provider's old
negotiation settled on exactly that path. Fixed on this branch
(`fix(local-ai): disable thinking on native Ollama calls; prefer native
mode`): native bodies carry `think: false` (verified harmless on the
non-thinking 8B) and unknown-mode negotiation is native-first with 404/405
compat fallback. Full suite 2,132/2,132 after the provider-test rewrite.

### Candidate 1 — `gemma4:26b-a4b-it-qat` (15GB resident, 100% GPU)

| Stage | Result | Gate |
|---|---|---|
| S0 chat | PASS (with think:false) | ✓ |
| S0 tools | PASS — clean call, correct args | ✓ |
| S0 JSON | PASS (with think:false) | ✓ |
| S0 embeddings | 768 dims (nomic-embed-text) | ✓ |
| Cold load | **11.2s** | ✓ (≤60s) |
| Decode | **34.5 tok/s** | ✓ (≥12–15) |
| S1 quality screen | **7/8 replies, FK avg 4.7, 0 over grade-8** — noticeably richer than the 8B (picks up scenario details like the transportation barrier), still comfortably plain-language | ✓ |
| S2 agent / S3 harness / S4 redteam | **NOT YET RUN** — the session ended mid-battery (8B finished, candidate had not started) | — |

### Baseline — `gemma4:latest` (8B incumbent control)

| Stage | Result |
|---|---|
| think:false tolerance | PASS (non-thinking model, flag harmless) |
| S1 quality screen | 7/8 replies, FK avg 3.2, 0 over grade-8 — serviceable but flatter, misses scenario specifics |
| **S2 agent eval** | **66.7% tool selection (30/45) — FAILS the ≥85% gate.** 0 injection-canary failures. 15 misses incl. save_job/prepare_for_interview/propose_resume_edit → "no tool", and submit_form → classify_attachment confusion |
| S3 chat harness | 9/14 — tool 3/4, guardrail 6/7, **grounding 0/3 INVALID (see DB caveat)**. Latency p50 **16.9s**, p95 28.2s — well past the ≤5s first-token target |
| S4 redteam | started, did not finish before session end |

**The 8B baseline empirically fails the agent lane** (66.7% vs an 85% gate) and
is far too slow (p50 16.9s). That is the owner's "too weak / too slow"
complaint reproduced as numbers — the floor is real, and the candidate has to
clear a bar the incumbent does not.

### ⚠ Environment caveat that invalidates part of S3

The harness needs a local Postgres; this machine had none running
(`localhost:5432` refused), so **every `grounding` case failed on
`PrismaClientInitializationError`, not on model behavior** — retrieval fell
back to keyword scoring and `programDocument.findMany` threw. One guardrail
failure may share that cause. Before trusting S3/S5, start a local DB and set
`DATABASE_URL` (S5 memory eval requires it outright).

Shared S1 note: `info-certs` returns empty on BOTH models — a harness-context
artifact (program-facts question with no tools/RAG supplied; the prompt
correctly forbids invention). Filed as its own task; not a model
differentiator.

## Owner decisions pending (from the plan)

Hardware placement/posture (never-sleep, FileVault-vs-unattended-boot, UPS, ethernet); model sign-off; degraded-mode option A/B/C; latency acceptance; Gemini judge in CI; Spanish product bar; LoRA (deferred).

## Resume here (next session)

Prereqs: `ollama serve` running (models already pulled: `gemma4:26b-a4b-it-qat`,
`gemma4:latest`, `nomic-embed-text`); a local Postgres with `DATABASE_URL` set
for grounding/memory stages.

```bash
export OLLAMA_URL=http://localhost:11434
export OLLAMA_MODEL=gemma4:26b-a4b-it-qat     # the candidate — run these FIRST

npm run sage:agent:eval   -- --provider=ollama                                    # S2 — gate ≥85%, 0 forbidden
npm run sage:chat:harness -- --provider=ollama --families=tool,guardrail,grounding --strict --temperature=0   # S3
npm run sage:redteam:eval -- --provider=ollama                                    # S4 — 0 hard failures
npm run sage:memory:eval                                                          # S5 — needs DATABASE_URL
```

The decisive question: **does the candidate clear ≥85% tool selection where
the 8B managed 66.7%?** If it does, it also has to clear S4 with zero hard
failures. If it clears both, the model recommendation is settled and the work
moves to migration (M0–M5: launchd daemons, tunnel, Render env, cutover).
If it fails S2, fall back to `qwen3:30b-a3b` (best open tool/JSON in class)
then `gpt-oss:20b`, same battery.

Also unresolved: p50 latency was measured on the 8B at 16.9s inside the
harness (vs 34.5 tok/s raw on the candidate) — measure the candidate's
harness-level first-token latency explicitly against the ≤5s target before
recommending it for interactive chat.
