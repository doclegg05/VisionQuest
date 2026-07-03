# Runbook: Sage Agent Staged Enablement (Phase 6)

**Goal:** Turn the Sage agent tool loop on in production gradually, gated by
evals at each step. The single control is `SAGE_AGENT_MODE`
(`off` | `readonly` | `full`) — see `sage-agent-rollback.md` for the kill switch.

There are only two live modes above `off`: **readonly** and **full**. The
confirm-card round-trip (HMAC, `write-tools.ts` `confirmationGate`) is the
boundary that makes `full` safe — consequential writes cannot execute without an
explicit user accept. Stages 6b/6c both run `full`; they differ in audience size,
not in mode.

## Stages

| Stage | Mode | Audience | What's live |
|-------|------|----------|-------------|
| 6a | `readonly` | staff test accounts | Read tools only (lookups, search, present). No writes. |
| 6b | `full` | staff + 1 pilot class | All tools. Consequential writes gated by confirm card. |
| 6c | `full` | all staff, opt-in students | Same as 6b, wider. Watch confirm-card accept/reject rates. |
| 6d | `full` | all live students | General availability. |

Advance one stage at a time. Hold at least one monitoring window (below) at each
stage before advancing. Roll back a stage the moment a precondition regresses.

## Per-stage preconditions (all must pass at temperature 0)

Run from the repo root with `GEMINI_API_KEY` set (or `--provider=ollama`). These
are deterministic at temp 0.

1. **Red-team: 0 hard failures**
   ```
   npm run sage:redteam:eval -- --strict
   ```
2. **Chat harness: tool + guardrail families green**
   ```
   npm run sage:chat:harness -- --families=tool,guardrail --strict --temperature=0
   ```
3. **Confirmation fixtures green** (new `confirmation` family — proves
   consequential requests surface a confirm proposal, not a direct write):
   ```
   npm run sage:chat:harness -- --families=confirmation --strict --temperature=0
   ```

Do not advance if any of the three reports a failure. (The `confirmation` family
is intentionally NOT in the CI gate yet; run it by hand here.)

## Making the change

In Render → web service → **Environment**:

- Stage 6a: `SAGE_AGENT_MODE=readonly`
- Stages 6b–6d: `SAGE_AGENT_MODE=full`

Save → Render restarts → effective next request.

## Per-stage monitoring window

Watch for at least a few hours of real traffic (or one class session) before
advancing. Check all three:

1. **Audit log — tool activity and any rate-limit blocks.**
   ```sql
   SELECT action, count(*)
   FROM visionquest."AuditLog"
   WHERE action LIKE 'sage.tool.%' AND "createdAt" > now() - interval '4 hours'
   GROUP BY action ORDER BY count DESC;
   ```
   A spike in `*.rate_limited` means a tool is being hammered — investigate before
   widening. The write ledger (`SageOperation`, `proposed` vs `executed`) shows
   confirm-card accept vs abandon.

2. **Prompt size / token deltas.** Enabling tools grows the system prompt (tool
   declarations) and per-turn tokens. Compare before/after:
   ```
   npm run sage:usage:summary -- --since=24h
   ```
   Watch `sage.prompt.size` and per-student token totals — a large jump risks the
   #97 daily token quota tripping students early.

3. **Latency.** The chat harness reports p50/p95/max per run:
   ```
   npm run sage:chat:harness -- --families=tool --temperature=0
   ```
   Compare p95 to the prior stage. A confirm-card round-trip adds a turn — expect
   a modest increase on consequential paths, not a cliff.

## Rollback

Any regression → set `SAGE_AGENT_MODE=readonly` (drop writes) or `off` (full
kill). See `sage-agent-rollback.md`. Rollback is env-only and effective on the
next request.
