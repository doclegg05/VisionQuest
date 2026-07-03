# Runbook: Sage Agent Rollback (Kill Switch)

**Purpose:** Turn the Sage agent tool loop off — or step it down — with an
env-only change. No deploy of code is required; the change takes effect on the
**next chat request** (the flag is read per request, not cached).

## The control: `SAGE_AGENT_MODE`

One env var governs everything. Values:

| Value | Effect |
|-------|--------|
| `off` | Agent tool loop disabled entirely. Chat falls back to plain streaming. Slash-command palette is empty. (Production default.) |
| `readonly` | Agent may call **read**-tier tools only. No writes, no confirmations. |
| `full` | Agent may call every tier. Consequential writes still require the confirm card. |

Legacy `SAGE_AGENT_ENABLED` is a deprecated fallback: it is consulted **only when
`SAGE_AGENT_MODE` is unset**. `SAGE_AGENT_ENABLED="false"` → `off`; anything else → `full`.
Prefer setting `SAGE_AGENT_MODE` explicitly.

## Full kill (fastest)

1. In Render → the web service → **Environment**, set:
   ```
   SAGE_AGENT_MODE=off
   ```
2. Save. Render restarts the service. Effective on the next request after restart.
   (Even without a restart, a fresh request re-reads the env.)
3. Confirm: open Sage chat, send a message. No tool calls should occur; a `/`
   slash prompt returns no palette (`GET /api/chat/slash-commands` →
   `{ "commands": [], "agentEnabled": false }`).

## Step down (keep coaching, drop writes)

If reads are fine but a write tool is misbehaving, step `full` → `readonly`
instead of a full kill:

```
SAGE_AGENT_MODE=readonly
```

Students keep lookups/search/present tools; every mutating tool disappears from
the model's tool set for the next request.

## Review what tools did (audit + ledger)

Two independent trails. Use `psql "$DATABASE_URL"` (read-only is fine).

- **AuditLog** — every tool run, rate-limit block, and result:
  ```sql
  SELECT "createdAt", action, summary
  FROM visionquest."AuditLog"
  WHERE action LIKE 'sage.tool.%'
  ORDER BY "createdAt" DESC
  LIMIT 50;
  ```
  Rate-limit blocks show as `sage.tool.<name>.rate_limited`.

- **SageOperation** — the write ledger (proposals + executions of gated tools):
  ```sql
  SELECT "createdAt", "toolName", status, "actorId", "resultSummary"
  FROM visionquest."SageOperation"
  ORDER BY "createdAt" DESC
  LIMIT 50;
  ```
  `status = 'proposed'` = confirm card shown but not yet accepted;
  `'executed'` = the write ran; `'failed'` = it errored.

To scope to one student, add `WHERE "actorId" = '<studentId>'`.

## Notes

- Rolling back does **not** undo writes already committed. Use the ledger above
  to find what executed, then correct via the normal teacher/admin UI.
- The kill switch is orthogonal to the token/cost quota (#97) and the per-tool
  rate limits — those keep working regardless of mode.
