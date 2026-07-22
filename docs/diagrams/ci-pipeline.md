# `/ci-pipeline` — stage flow

Visual companion to the design spec
([2026-07-22-ci-pipeline-command-design.md](../superpowers/specs/2026-07-22-ci-pipeline-command-design.md))
and the command (`.claude/commands/ci-pipeline.md`).

```mermaid
flowchart TD
    classDef orch fill:#3d403d,stroke:#565956,color:#f2f2f0
    classDef agent fill:#4b4b9e,stroke:#6c6cd4,color:#efeffc
    classDef owner fill:#8a3b1e,stroke:#c05a33,color:#fbe9df

    S1["Stage 1 — intake<br/>issue number or freeform text"]:::orch
    S2A["Stage 2 — scout<br/>scout agent (subagent): read-only recon"]:::agent
    S2B["Stage 2 — plan<br/>spec + mapped test plan"]:::orch
    GATE["Plan approval — the only gate<br/>owner approves, then unattended"]:::owner
    S3["Stage 3 — build<br/>builder (inline role): tests-first, wiring proof"]:::agent
    S4A["Stage 4 — local gate<br/>gate-runner (inline role): six checks,<br/>plus prisma validate when schema touched"]:::agent
    S4B["Stage 4 — review pass<br/>code-reviewer agent (subagent) on diff"]:::agent
    S5A["Stage 5 — push + draft PR<br/>draft PR triggers CI"]:::orch
    S5B["Stage 5 — watch CI<br/>gh pr checks --watch"]:::orch
    S6["Stage 6 — finalize draft PR<br/>results, walkthrough, Closes #n"]:::orch
    SHIP["Engineer review + ship<br/>pipeline never merges; owner ships"]:::owner

    S1 --> S2A --> S2B --> GATE --> S3 --> S4A --> S4B --> S5A --> S5B --> S6 --> SHIP
    S4A -->|"fail (max 3)"| S3
    S5B -->|"fail (max 2)"| S3
```

## Legend and execution model

- **Gray — orchestrator step**: the main session executing the command directly.
- **Purple — named agent role** (reusable definitions in `.claude/agents/`):
  - `scout` and `code-reviewer` run as **dispatched subagents**.
  - `builder` and `gate-runner` are contracts the orchestrator **assumes
    inline** — deliberately, so fix-loops keep memory of prior attempts.
- **Rust — owner (human)**: the only two human touchpoints. Plan approval is
  the single mid-pipeline gate; everything after it runs unattended until the
  finalized draft PR arrives for Engineer Review. The pipeline never merges.

## Fail-loops

- **Local gate → build** (max 3): failing command output, verbatim, becomes the
  next build instruction; the full gate re-runs from the top after each fix.
- **Watch CI → build** (max 2): `gh run view <id> --log-failed` output becomes
  the next build instruction; the full local gate re-runs before re-push.
- Hitting either cap produces an honest failure report — never a silent stall,
  never a weakened test, never a red push.

## Vague-ticket path (not shown)

If intake cannot produce testable acceptance criteria, numbered clarifying
questions surface *at* the plan-approval gate rather than as extra stops — the
"only gate" property holds on every path.
