# Sage latency SLO

This page states the latency targets for Sage's AI calls, where the
underlying data comes from, how to check current latency against the
targets, and what to do when a target is missed.

## The stated targets

Every AI call is checked against a p95 latency bar. A bar is the value below
which 95% of calls in the measured window should finish. The bars live in
[`config/sage-slo.json`](../config/sage-slo.json), which is the source of
truth. This page explains them in plain language, but that file is what the
report script actually reads.

| Path | Provider | p95 bar | Why |
|------|----------|---------|-----|
| Chat (`sage_chat`) | Gemini (cloud) | 6,000 ms | The nightly chat harness measures a real p50 of 1,283 ms and p95 of 1,816 ms. The bar sits well above that so ordinary jitter never trips it, while a roughly 3x regression still does. |
| Chat (`sage_chat`) | Ollama (local) | 90,000 ms | Local turns are accepted to run 20-70 seconds with reasoning disabled by default. The bar sits just above that accepted range. |
| Everything else (background/extraction: goal and mood extraction, briefings, agent tool calls, embeddings, memory, form search, file gist) | any | 45,000 ms | These run off the critical path (the student is not waiting on them), so the bar is looser. It is a single best-guess default rather than a per-provider split, since this is not yet backed by measured background-call data. |

The chat bars are the ones that matter most: they cover the path a student is
actively waiting on. The background bar exists mainly to catch a call that is
stuck rather than merely slow.

## Where the data comes from

Every AI call VisionQuest makes is logged to the `LlmCallLog` table,
including a `durationMs` column measured from just before the call starts to
just after it resolves (see `src/lib/llm-usage.ts`). That column has been
written on every call for a while, but until now nothing read it back. The
existing usage report summarized only token counts and cost.

`durationMs` can be `null` on some rows (calls logged before duration
tracking existed, or a call that failed before it could record one), so the
report always shows how many rows in a group actually carried a duration
alongside the percentiles, rather than silently treating a missing value as
zero.

## How to check

Run the usage summary script, which now reports duration percentiles per
call site and per model, and flags any breach:

```bash
npm run sage:usage:summary
```

Useful variations:

```bash
# Wider window
npm run sage:usage:summary -- --since=30d

# Machine-readable report (includes the same duration/SLO fields)
npm run sage:usage:summary -- --json

# Point at a different SLO file, e.g. to try out a proposed bar change
npm run sage:usage:summary -- --slo-config=config/sage-slo.json

# Preview the report shape with synthetic data, no database call at all
npm run sage:usage:summary -- --dry-run
```

`--dry-run` is useful when you want to see what the report and the breach
check look like without a working database connection. It never touches
`LlmCallLog`, and it never writes anything.

A normal run prints one line per call site, a `duration ms` summary
(`n`, `mean`, `p50`, `p95`, `max`), and a per-model breakdown that marks each
model `ok` or `SLO BREACH` against its bar. A `SLO check` section at the
bottom lists every breach found, or says plainly that there were none. If the
chosen window has no `LlmCallLog` rows at all, the script says so and
suggests widening `--since` rather than printing an empty table.

## What to do on breach

1. Confirm it is real: re-run with a slightly wider `--since` to rule out a
   one-off spike from a handful of calls.
2. Check which provider and call site breached. A `sage_chat` breach is the
   one that matters most, since it is the path a student is waiting on live.
3. Look for a known cause first: a large local model with reasoning
   accidentally left on, a cloud provider incident, a burst of unusually long
   prompts. `.claude/MEMORY.md` (Known Issues) tracks the latency gotchas
   that have come up before.
4. If the cause is not obvious, treat it as a real regression and
   investigate the code path for that call site before assuming the bar
   itself is wrong.
5. If the bar itself turns out to be miscalibrated (for example, the
   background default in `config/sage-slo.json` was a best guess with no
   measured data behind it), update the bar and its `notes` entry in the same
   change, with the reasoning for the new number spelled out the same way the
   existing bars are.
