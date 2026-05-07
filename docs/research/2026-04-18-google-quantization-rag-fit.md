# Google Quantization for RAG — Research Report

**Date:** 2026-04-18
**Requested by:** Britt Legg
**Branch:** research/google-quantization-rag (no code changes)

---

## What the User Is Referring To

The strongest match is **TurboQuant**, a vector quantization algorithm published by Google Research at **ICLR 2026** (accepted late 2025, arXiv April 2025). The paper is: *"TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate"* by Zandieh, Daliri, Hadian, and Mirrokni from Google Research.

- **arXiv:** https://arxiv.org/abs/2504.19874
- **ICLR paper:** https://openreview.net/pdf/6593f484501e295cdbe7efcbc46d7f20fc7e741f.pdf
- **Community implementations on GitHub:** `back2matching/turboquant` (KV cache, Apache 2.0), `jorgebmann/pyturboquant` (RAG/embeddings, MIT, WIP v0.1.0)
- Google has **not** released an official implementation. Both repos above are community implementations of the published algorithm.

There is a second plausible candidate — **EmbeddingGemma** (Google DeepMind, September 2025) — which is an open-weights 308M parameter embedding model with QAT (Quantization-Aware Training) that runs under 200MB RAM. It is distinct from TurboQuant: EmbeddingGemma is an embedding *model*; TurboQuant is a *compression algorithm* you apply to vectors from any model. The fit analysis below covers both.

---

## What TurboQuant Does Technically

- **Core idea:** Randomly rotate embedding vectors before quantization. This spreads the signal across all dimensions uniformly, then apply optimal scalar quantizers per dimension. Coordinates become near-independent, so per-channel scalar quantization becomes mathematically near-optimal — no correlation assumptions needed.
- **Two-stage design:** Stage 1 (PolarQuant) minimizes MSE distortion. Stage 2 adds a 1-bit Quantized JL residual that corrects the bias in inner-product estimation (which is what nearest-neighbor search actually needs).
- **What it compresses:** Can compress float32 (4-byte) vectors down to 3–4 bits per dimension. A 768-dimension embedding drops from 3,072 bytes to ~392 bytes at 4-bit — roughly 7.8× smaller.
- **What it preserves:** Near-neighbor ranking. Inner-product distances are preserved near-optimally even at aggressive compression rates. This is the key property for RAG: you need "which document is most similar?" to remain correct, not the exact vector values.
- **Two use cases addressed by the paper:**
  1. KV cache compression for LLM inference (the primary paper focus — 6× memory reduction, ~8× attention speedup on H100)
  2. Embedding vector search for RAG / semantic retrieval (the secondary focus, addressed in pyturboquant)
- **No training required:** Works on any pre-existing embedding vectors. Drop-in compression.
- **License:** The community implementations are Apache 2.0 and MIT. The paper itself is research-only; Google has not open-sourced an official codebase.

---

## What EmbeddingGemma Does Technically

- **Model:** 308M parameter text embedding model, open weights under the Gemma license (commercial use allowed with restrictions).
- **Quantization approach:** Quantization-Aware Training (QAT) baked into the model itself — it learns to produce high-quality embeddings even when quantized to int8. Result: sub-200MB RAM to run the model.
- **MRL support:** Uses Matryoshka Representation Learning — embeddings can be truncated to smaller dimensions (e.g., 256 instead of 1024) without retraining, and still maintain reasonable quality.
- **What it solves:** Running an embedding model locally on-device (phone, laptop, Mac Studio) rather than calling a cloud API.
- **Integration:** Works with sentence-transformers, Ollama, llama.cpp, LiteRT, LangChain. Available on Hugging Face (`google/embeddinggemma-300m`).

---

## VisionQuest Fit Assessment

### TurboQuant — Verdict: Interesting, but overkill at current scale and pre-activation

**The honest read:** TurboQuant solves a real problem — it cuts embedding storage and search memory by 7–8× at near-zero quality loss. But VisionQuest does not yet have a single embedded document. The RAG system from PR #20 is dormant: no documents in `docs-upload/`, no pgvector column in the schema, no ingestion ever run. The current "RAG" is keyword matching against empty DB tables. Applying TurboQuant right now is equivalent to buying a very efficient gas cap for a car that has no engine.

**When it becomes relevant, in order:**

1. **Now → RAG activation:** Not relevant. Zero corpus.
2. **After activation (first 50–200 SPOKES documents):** Still not relevant. The keyword-matching approach the code already has is sufficient for this corpus size. The upgrade comment already in `knowledge-base.ts` ("Revisit when corpus exceeds 100 documents and keyword matching precision suffers") is the right call — pgvector plain cosine similarity is the next step, not TurboQuant.
3. **After Mac Studio migration (~June 2026) + pgvector adoption + corpus scales to 500–5,000 documents:** This is when TurboQuant becomes worth evaluating. If you're running a local embedding model on the Mac Studio (EmbeddingGemma via Ollama, for example), storing vectors in Supabase, and doing real nearest-neighbor search at query time — that's when 7–8× memory reduction and faster ANN search are meaningful levers.
4. **The specific pain TurboQuant solves — running out of RAM for vectors — is not a current or near-term constraint.** Supabase free tier gives you 500MB database storage. Even at 1,536 dimensions (Gemini text-embedding-004 output), 1,000 documents with chunking at ~10 chunks/doc = 10,000 vectors × 6,144 bytes = ~62 MB. That fits in Supabase free tier with room to spare, uncompressed.

### EmbeddingGemma — Verdict: Relevant at Mac Studio migration, not before

EmbeddingGemma is directly relevant to the Mac Studio plan: it is a high-quality multilingual embedding model that runs under 200MB RAM via Ollama, is already in the Ollama model library (`ollama pull embeddinggemma`), and supports the SPOKES use case (multilingual, 100+ languages). When you migrate to local AI and want to keep embeddings local too (student data privacy, no cloud API costs), EmbeddingGemma is the embedding model to pull alongside Gemma 4. It's not about "quantization for memory" as a separate thing to adopt — the quantization is already baked in; you just pull and use it.

---

## If It Is a Fit: Phase Boundaries

### Phase 1 — Now (RAG dormant, pre-pgvector)
**Nothing to do with TurboQuant or EmbeddingGemma.** The blocking task is activating the existing RAG pipeline:
1. Wake Supabase from dashboard
2. Populate `docs-upload/` with actual SPOKES PDFs and program documents
3. Run `npm run seed:app-knowledge && npm run ingest`
4. The keyword-matching RAG in `getDocumentContext()` will then return real content

### Phase 2 — After activation, corpus < 200 docs
**Upgrade keyword matching to pgvector cosine similarity.** The code already has the upgrade path comment. Steps:
- Add pgvector extension to Supabase (one SQL command: `CREATE EXTENSION vector`)
- Add `vector(1536)` column to the `ProgramDocument` table (Prisma migration)
- Switch ingestion to call `text-embedding-004` via Gemini API and store vectors
- Replace keyword scoring in `getDocumentContext()` with `ORDER BY embedding <=> query_embedding LIMIT 5`
- No TurboQuant needed — the corpus is small enough that plain pgvector is fast and Supabase storage is not a constraint

### Phase 3 — Mac Studio migration + corpus growing (post June 2026)
**EmbeddingGemma replaces the Gemini embedding API call.** Since the provider abstraction in `src/lib/ai/` already supports Ollama, add an embedding provider path:
- `ollama pull embeddinggemma`
- Add `OllamaEmbeddingProvider` to the provider abstraction alongside `GeminiEmbeddingProvider`
- Flip via admin toggle (same pattern as the chat provider)
- No schema changes, no re-architecture — just a new provider implementation (~80 lines)

**TurboQuant re-evaluate at 1,000+ documents or if pgvector query latency degrades.** If the Mac Studio is running both the generative model and the embedding model, and the vector index grows into thousands of rows, the index scan time in pgvector becomes a real number. At that point, pyturboquant's `TurboQuantIndex` (FAISS-style, pure PyTorch) or pgvector's native half-vector compression (`halfvec`) would be the levers to pull. The pgvector `halfvec` route (scalar quantization, 16-bit floats, 50% size reduction) is probably the right first step before pyturboquant, since it's already in Supabase's pgvector build.

---

## What Would Actually Help the User's Underlying Question Right Now

Based on the speed research done 3 hours ago, the actual bottleneck is **prompt size to Gemini, not retrieval or embedding memory.** The 2-minute response time comes from a 10,000–14,000 token system prompt being processed by Gemini 2.5 Flash Lite, not from a slow vector search. The RAG layer is dormant and returns empty strings.

The three highest-ROI actions (from `2026-04-18-sage-response-speed.md`) are:
1. Increase cache TTLs (30s → 300s) — near-zero effort
2. Stage-gate the SPOKES knowledge block injection — cuts prompt by 4,000–8,000 tokens for check-in/goal stages
3. Prefetch context on chat page mount — eliminates the cache miss for returning students

None of those involve quantization. Quantization becomes relevant when you have an embedding model running and a vector index to compress — probably 3–6 months out.

---

## Summary

| Technology | What It Is | Relevant Now? | When Relevant |
|-----------|-----------|--------------|---------------|
| TurboQuant (Google Research, ICLR 2026) | Vector compression algorithm — 7–8× smaller embeddings at near-zero quality loss | No | After Mac Studio + pgvector + 1,000+ doc corpus |
| EmbeddingGemma (Google DeepMind, Sept 2025) | Quantized on-device embedding model, 308M params, <200MB RAM | No | At Mac Studio migration — replace Gemini embedding API |
| pgvector halfvec (scalar quantization) | 16-bit float vectors in Supabase, 50% storage reduction, already available | No | After RAG activation + corpus >200 docs |
| pgvector plain cosine similarity | Semantic retrieval replacing keyword matching | After RAG activation | Phase 2 of RAG build-out |
