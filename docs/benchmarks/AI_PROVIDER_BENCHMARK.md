# Gemini Flash-Lite vs GPT-5 mini benchmark

This is a separate, evaluation-only harness for comparing VisionQuest's current `gemini-3.1-flash-lite` configuration with `gpt-5-mini`. It does not import, replace, or modify the production provider resolver in `src/lib/ai/`. Production data-sensitivity routing and defaults remain unchanged.

## Privacy boundary

The harness is intentionally disconnected from VisionQuest databases, APIs, uploads, RAG storage, and production systems. Its only input is a reviewed JSON fixture file.

- Every fixture set must declare `dataClassification: "public_synthetic"`.
- Every case context must start with `[PUBLIC SYNTHETIC FIXTURE]`.
- A preflight guard rejects common direct identifiers, protected-data field names, and the production URL before any provider call.
- The runner never loads `.env.local`; credentials must already be present in the process environment.
- The fixture set contains aggregate, fictional, or public-style content only. Do not paste student records, staff-entered notes, exports, transcripts, or database values into it.
- Generated artifacts can contain model outputs and synthetic prompts. They are written beneath the gitignored `artifacts/` directory.

The guard reduces accidental disclosure risk but is not a de-identification tool. Human review of fixture changes is still required.

## What is held constant

For every case, `normalizeBenchmarkRequest` constructs one canonical request containing:

- one fixed system prompt;
- the exact same fixture context and user request;
- a single fixed generation limit (`maxOutputTokens: 512`);
- no tools, live retrieval, provider-specific grounding, or conversation state.

The adapters map that canonical request to Gemini `streamGenerateContent` and the OpenAI Responses API. Both calls stream so the harness can measure time to the first non-empty text delta. OpenAI requests use `store: false`. The harness runs exactly three repetitions per provider and case. All 36 calls are shuffled using a recorded random seed and execute sequentially to avoid cross-provider concurrency effects.

The default models can be overridden for a deliberate follow-up experiment, but a run manifest always records the effective model IDs:

```text
GEMINI_MODEL=gemini-3.1-flash-lite
OPENAI_MODEL=gpt-5-mini
```

## Documentation basis

The implementation and pricing snapshot were checked on 2026-07-28 against:

- [Gemini streamed content API](https://ai.google.dev/api/generate-content)
- [Gemini 3.1 Flash-Lite model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [GPT-5 mini model card and pricing](https://developers.openai.com/api/docs/models/gpt-5-mini)
- [OpenAI streaming Responses guide](https://developers.openai.com/api/docs/guides/streaming-responses)

The cost estimate uses standard text-token rates from that snapshot:

| Model | Input / 1M | Cached input / 1M | Output / 1M |
| --- | ---: | ---: | ---: |
| Gemini 3.1 Flash-Lite | $0.25 | $0.025 (not used by this harness) | $1.50, including thinking tokens |
| GPT-5 mini | $0.25 | $0.025 | $2.00 |

Pricing changes over time. Recheck the official pages and update `scripts/ai-benchmark/pricing.mjs` before using cost to make a production decision.

## Fixture coverage

`config/ai-provider-benchmark.json` starts with six cases:

1. student-facing plain-language coaching;
2. an instructor-facing aggregate summary;
3. structured JSON extraction;
4. a retrieval-style question grounded only in a supplied excerpt;
5. a privacy-canary refusal;
6. a crisis-safety response.

Machine checks cover required terms, forbidden terms, word limits, and a small JSON-shape validator. These checks catch format and hard-constraint failures; they do not replace blind human review.

## Commands

Validate configuration and randomized scheduling without requiring API keys or sending requests:

```bash
npm run ai:benchmark -- --dry-run
```

Run the live benchmark only from an approved environment with evaluation credentials:

```bash
npm run ai:benchmark
```

Optional reproducibility and output arguments:

```bash
npm run ai:benchmark -- --seed 12345 --out artifacts/ai-benchmark/manual-run
```

After reviewers fill every 1–5 score in `blind-scoring.csv`, calculate the decision:

```bash
npm run ai:benchmark:score -- --run artifacts/ai-benchmark/<run-id>
```

## Artifacts

Each run directory contains:

- `manifest.json`: model IDs, seed, fixture hash, generation settings, privacy result, pricing snapshot, and documentation links;
- `runs.jsonl`: provider-labelled timings, token usage, estimated cost, validity, errors, and output for every call;
- `summary.json`: per-provider aggregate machine metrics;
- `blind-outputs.jsonl`: shuffled A/B outputs without provider names;
- `blind-scoring.csv`: the human worksheet;
- `blind-key.json`: the separate unblinding map;
- `decision.json`: created only after a complete worksheet is scored.

Keep `blind-key.json` away from reviewers until scoring is complete.

## Decision rule

The challenger is GPT-5 mini; the incumbent is Gemini 3.1 Flash-Lite. The composite quality score is the mean of the five rubric dimensions in the scoring guide.

Switch only when GPT-5 mini has no material safety regression and either:

1. its composite quality advantage is at least **0.4 points on the 5-point scale**, or
2. quality is equal within **0.1 points** and GPT-5 mini improves median full duration or mean estimated cost by at least **20%**.

A safety difference worse than 0.1 points blocks a switch. First-token timing is reported for diagnosis, while median full duration is the speed metric used in the rule. Machine validity failures and provider errors should be reviewed before accepting any recommendation.

This benchmark can support a routing decision; it does not make or deploy one.
