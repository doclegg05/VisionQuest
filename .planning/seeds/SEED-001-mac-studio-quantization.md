---
id: SEED-001
status: dormant
planted: 2026-04-18
planted_during: sage-speed-and-chat-redesign
trigger_when: "Mac Studio arrives / is installed / user says 'I added the Mac Studio'"
scope: medium
---

# SEED-001: Activate quantized embeddings stack when Mac Studio arrives

## Why This Matters

VisionQuest is migrating Sage from Google Gemini API to a local Gemma model running on a Mac Studio (~June 2026, per `project_local_ai.md` memory). Once the Mac Studio is the inference host, the constraint picture flips:

- **Now:** Gemini API handles embeddings for free; RAM isn't a concern.
- **After Mac Studio:** the chat model (Gemma) and any embedding model compete for RAM on one machine. A quantized embedding model pays for itself instantly.

EmbeddingGemma (Google DeepMind, Sept 2025) is a 308M-param embedding model with QAT baked in, runs under 200MB RAM, available on Ollama. It's effectively a drop-in upgrade path behind the existing `src/lib/ai/` provider abstraction.

Separately, TurboQuant (Google Research, ICLR 2026) is a 3–4 bit vector quantization algorithm that becomes relevant only when the SPOKES document corpus grows past ~1,000 documents and pgvector query latency becomes measurable. Community implementations only (no official Google repo); not needed at small scale.

## When to Surface

**Trigger:** User indicates Mac Studio is installed / received / running — phrases like:
- "I added the Mac Studio"
- "Mac Studio is here"
- "Mac Studio arrived"
- "migrating to the local AI now"
- Or: a new milestone scoped to local-AI migration

When any of these fire, this seed should be presented alongside the migration plan.

## Scope Estimate

**Medium** — one phase of work, not a full milestone:

1. Install Ollama on Mac Studio (probably already planned for Gemma anyway)
2. Pull EmbeddingGemma via `ollama pull embeddinggemma`
3. Add an `embeddings` method to the existing provider in `src/lib/ai/` — mirrors the chat provider pattern
4. Swap the current Gemini embedding call in `src/lib/sage/ingest.ts` to use the provider
5. Re-ingest the SPOKES corpus (if by then it's been populated — see `project_rag_system.md`)
6. Verify retrieval quality vs. Gemini embeddings on a handful of canonical queries

TurboQuant evaluation is **deferred** to a later trigger ("SPOKES corpus passed 1,000 documents") — not part of this seed's action.

## Breadcrumbs

Code and decisions that will matter when this activates:

- `docs/research/2026-04-18-google-quantization-rag-fit.md` — full research report with phased path and technical details (on `research/google-quantization-rag` branch; merged into this branch via PR)
- `src/lib/ai/` — provider abstraction that makes the swap clean
- `src/lib/sage/ingest.ts` — where the embedding call lives today (or will live when RAG is activated)
- `src/lib/sage/knowledge-base.ts` — comment marking the pgvector upgrade path
- Memory: `~/.claude/projects/-Users-brittlegg-visionquest/memory/project_local_ai.md`
- Memory: `~/.claude/projects/-Users-brittlegg-visionquest/memory/project_rag_system.md`
- Memory: `~/.claude/projects/-Users-brittlegg-visionquest/memory/project_mac_studio_quantization_trigger.md` — the trigger memory paired with this seed

## Notes

The user originally asked about "Google's quantization for memory" — the research agent identified two candidates (TurboQuant + EmbeddingGemma). The verdict was that neither is useful *today* (RAG dormant, zero documents ingested, Gemini prompt tokens are the actual bottleneck — already fixed in PR #30). But EmbeddingGemma is a genuine win *at* Mac Studio migration, not before.

Precondition for full value: the SPOKES document corpus needs to be ingested (content task, not a code task) — otherwise the embedding stack has nothing to embed. Ideally that happens before Mac Studio arrives so we're not doing two cold starts back-to-back.

One-line summary for quick recall: **"Mac Studio day → install EmbeddingGemma via Ollama, wire through the existing provider abstraction, re-embed the SPOKES corpus. Skip TurboQuant until we pass 1,000 docs."**
