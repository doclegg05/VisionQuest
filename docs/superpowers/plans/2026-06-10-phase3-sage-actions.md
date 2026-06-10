# Phase 3 — Agentic Sage: Write Tools + Files Through Chat

> Executed inline by the orchestrator loop. Scope contract: Phase 3 section of
> `2026-06-09-chat-first-rebuild-master-plan.md`. The `SageOperation` ledger model
> shipped with Phase 2 (PR #71); this phase adds its helper + everything else.

**Goal:** Students hand Sage files in chat (signed forms, documents); Sage classifies
and files them with consent-gated cloud processing; Sage gains write tools with
confirm-before-execute UX, all ledgered + audited.

## Tasks

- [x] **T1 Consent** — `ConsentRecord` model + migration (studentId, scope
  `cloud_file_processing`, grantedAt, revokedAt?, recordedBy); `src/lib/consent.ts`
  (hasActiveConsent/grantConsent/revokeConsent, zod, audit-logged); student API route
  `/api/settings/consent` (GET/POST); settings toggle UI; consent step in
  OrientationWizard. Tests for consent lib.
- [x] **T2 Operations ledger helper** — `src/lib/sage/operations.ts`:
  `operationIdFor(slug, clock)` deterministic id; `recordOperation()` writes
  SageOperation + AuditLog. Tests (clock injected).
- [x] **T3 Chat upload pipeline** — `POST /api/chat/upload` (auth, zod, MIME
  allowlist + 25MB reusing files-route validation): store to Supabase Storage →
  FileUpload row (category "chat") → if `hasActiveConsent(cloud_file_processing)`:
  upload to Gemini Files API (resumable upload → file_uri) and extract a text gist
  natively; else local extractTextFromBuffer. Returns attachment descriptor
  {fileUploadId, filename, gist}. Tests for the consent branch (mocked).
- [x] **T4 Attachment context in chat** — chat composer attach button
  (`src/components/chat/`); `/api/chat/send` accepts `attachmentIds`, injects an
  ATTACHED FILE block (filename + gist) into the turn so Sage can discuss/classify it.
- [x] **T5 Write tools + confirmation flow** — extend `AgentToolResult` with
  `requiresConfirmation` + `confirmationToken` pattern: tool call with
  `confirm: false` returns a proposal card; UI confirm button re-invokes via
  `/api/chat/tool-confirm` (CSRF, role-gated, token single-use). Tools in
  `src/lib/sage/agent/tools.ts`: `file_document` (attach FileUpload to cert
  requirement evidence or doc category), `submit_form` (link signed upload to
  orientation item / form template, flip status, notify teacher),
  `update_goal_status`, `save_job`, `add_portfolio_item` (no confirm — trivially
  reversible), `mark_requirement_complete` (proposes; teacher verification unchanged),
  `book_appointment` (confirm card). Every execution: recordOperation + AuditLog.
- [x] **T6 Safety** — executor-level role gating tests; prompt-injection suite
  (malicious filename/gist content trying to trigger unconfirmed writes must yield
  proposals only, never direct execution); confirmation tokens unforgeable
  (HMAC over op payload, secret = JWT_SECRET, 10-min expiry).
- [x] **T7 Enable + eval** — SAGE_AGENT_ENABLED default true; maxHops 8;
  `config/sage-agent-eval.json` (≥25 scripted scenarios) +
  `scripts/sage-agent-eval.mjs` reporting tool-selection accuracy with the live
  model. Honest numbers.
- [x] **T8 Golden path test** — integration test: signed orientation form uploaded →
  classified → filed → orientation item flips → ledger + audit rows exist.
- [x] **T9 Gates + PR** — full suite, eslint, typecheck, build; migrations via
  `prisma migrate deploy` (NEVER migrate dev — resets the shared dev DB); PR.

**Acceptance (master plan):** golden path passes; every write tool execution has
ledger + audit rows; prompt-injection suite passes; no tool executes outside the
actor's role permissions.
