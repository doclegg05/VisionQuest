# Sage Agent Protocol — Frontend ↔ Backend Contract

**Date:** 2026-05-05
**Status:** Draft — implementation in progress
**Audience:** Anyone building Sage's chat surface (UI + backend)

---

## Why this document exists

Sage is moving from **chatbot** (text-in, text-out) to **agent** (text + actions + file context). The chat UI and the chat backend are being built in parallel by two different agents (Codex on UI; Claude on backend). This spec is the contract they both target so the pieces fit when they meet.

Two design principles drive everything below:

1. **Distinct SSE event types over embedded JSON.** Sage's actions ride on dedicated event types (`tool_call`, `action`, `attachment_ack`), not parsed from the visible reply text. Robust to model drift; clean separation.
2. **Server-side execution.** All tool calls execute server-side under the existing `withRegistry` middleware so audit, role gating, and rate limits are enforced exactly as they are for direct API calls.

---

## 1. SSE Event Types (backend → UI)

Every event is one line of `data: <json>\n\n` per the existing SSE convention in `src/lib/chat/sse.ts`. The chat UI reads each event, dispatches by `type`, and updates state.

### Existing event types (unchanged)

| `type` | Payload | When |
|---|---|---|
| `conversationId` | `{ conversationId: string }` | First event of every stream |
| `text` | `{ text: string }` | Each token/chunk of Sage's visible reply |
| `done` | `{ done: true, conversationId: string }` | End of turn |
| `error` | `{ error: string }` | Any fatal error during the turn |

### New event types

#### `tool_call` — Sage decided to call a tool
```ts
{
  type: "tool_call",
  callId: string,            // server-generated, opaque to UI
  tool: string,              // e.g. "present_form", "find_certification"
  args: Record<string, any>, // model-supplied arguments
  status: "pending"          // always "pending" on first emit
}
```
UI treatment: render an inline status pill ("Looking up form…"). Don't block streaming — text events may continue around it.

#### `tool_result` — Tool finished executing
```ts
{
  type: "tool_result",
  callId: string,            // matches the prior tool_call
  status: "success" | "error",
  summary: string,           // 1-line human-readable, safe to render
  data?: unknown             // structured payload, schema depends on tool
}
```
UI treatment: replace the pending pill with success/error state. The `summary` is what the user sees; `data` is for richer rendering (e.g., embedding a form preview).

#### `action` — UI-rendered action Sage wants to surface
```ts
{
  type: "action",
  action: "navigate" | "open_form" | "open_resource" | "highlight",
  target: string,            // URL, form id, resource id, or selector
  label: string,             // button text the UI should render
  meta?: Record<string, any> // optional extras (e.g., highlight color)
}
```
UI treatment: render as a clickable inline button card in the chat (think Claude/ChatGPT artifacts). Clicking executes the action. **The UI never auto-navigates without a click** — student/teacher confirms the move.

#### `attachment_ack` — Backend received & classified an attachment
```ts
{
  type: "attachment_ack",
  attachmentId: string,
  classification?: {
    kind: "certificate" | "form" | "image" | "document" | "unknown",
    confidence: number,      // 0..1
    detectedFields?: Record<string, string>  // e.g., { certName: "IC3 GS6 Level 1", dateEarned: "2026-04-15" }
  },
  storagePath?: string       // Supabase path if persisted
}
```
UI treatment: show a "Sage saw your file" indicator on the attached file in the chat. May feed into Sage's next reply (e.g., "Looks like IC3 GS6 Level 1 from 4/15 — file it?").

### Heartbeat
Existing `: heartbeat\n\n` comments continue every 15s. No change.

---

## 2. Slash Commands

The chat UI shows a slash-command menu (like Claude Code, ChatGPT). The list is **server-driven** so adding a command is a backend-only change.

### `GET /api/chat/slash-commands`

Returns the current student's available slash commands based on role + feature flags.

**Response:**
```ts
{
  commands: Array<{
    name: string;             // "/form", "/cert", "/goal"
    label: string;            // "Open a form"
    description: string;      // shown in the menu
    argHint?: string;         // "form name or id"
    requiresArg: boolean;
  }>
}
```

**Example response (student):**
```json
{
  "commands": [
    { "name": "/form",   "label": "Open a form",          "description": "Pull up any program form by name", "argHint": "form name or id", "requiresArg": true },
    { "name": "/cert",   "label": "Find a certification", "description": "Search the certification catalog", "argHint": "cert name", "requiresArg": false },
    { "name": "/goals",  "label": "Show my goals",        "description": "Open your goals dashboard",        "requiresArg": false },
    { "name": "/upload", "label": "Upload a certificate", "description": "Send Sage a cert image or PDF to file", "requiresArg": false }
  ]
}
```

### How slash commands route

When the user types `/form spokes-profile` and submits, the chat UI sends the message verbatim. The backend:
1. Detects the leading `/<word>` prefix.
2. Looks up the command in the registry.
3. **Treats it as an explicit tool invocation** — emits `tool_call` for the corresponding tool, runs it, returns `tool_result` and any `action` events.
4. Sage may follow up with text framing the result.

This means slash commands are syntactic sugar — the same tools the model can call autonomously can also be invoked explicitly by the user. No separate code path.

---

## 3. File Attachments (UI → backend)

The UI sends file uploads alongside the chat message. Two transport options; pick whichever Codex prefers:

### Option 3A — Multipart form (recommended)
`POST /api/chat/send` accepts `multipart/form-data` with:
- `message` field (string)
- `conversationId` field (string | null)
- `requestedStage` field (optional string)
- One or more `attachment` fields (File)

### Option 3B — Pre-upload + reference
1. UI uploads file to `POST /api/chat/attachments` → returns `{ attachmentId, storagePath, mimeType, sizeBytes }`.
2. UI sends chat message with `attachmentIds: string[]` array in the JSON body.

**Recommendation:** Start with **3A** for simplicity. Switch to 3B later if we need pre-upload progress bars.

### Backend handling

For each attachment:
1. Validate MIME against allowlist (image/png, image/jpeg, image/webp, application/pdf).
2. Persist to Supabase Storage under `chat-attachments/{studentId}/{conversationId}/{attachmentId}`.
3. Run the `classify_attachment` tool synchronously (vision pass for images, text extraction for PDFs).
4. Emit `attachment_ack` event with classification.
5. Inject attachment context into Sage's prompt so she can reference it in her reply.

Max attachment size: **10 MB per file**, up to **3 files per message** for v1.

---

## 4. Tool Catalogue (Phase 1)

Phase 1 ships ~6 tools. All read-only or low-risk. Each tool definition is a Gemini-compatible `FunctionDeclaration`.

| Tool name | Args | Returns | Phase |
|---|---|---|---|
| `present_form` | `{ formId: string }` | Emits `action: open_form` | 1 |
| `find_certification` | `{ query: string }` | Up to 5 matches from `SpokesModuleTemplate` | 1 |
| `lookup_appointment` | `{ withinDays?: number }` | Upcoming appointments for the student | 1 |
| `open_resource` | `{ resourceId: string }` | Emits `action: open_resource` | 1 |
| `classify_attachment` | `{ attachmentId: string }` | Vision/text analysis result | 1 |
| `summarize_progress` | `{ studentId?: string }` | Brief progress snapshot (for teacher chat) | 1 |

Phase 2+ (write actions, deferred):
- `mark_certification_complete`
- `book_appointment`
- `update_goal_status`
- `submit_form`

Every Phase 2+ tool MUST trigger an `action` event with a confirm/cancel button before mutating data. The model never writes silently.

---

## 5. Agent Loop (backend internal)

Pseudocode for the chat route's per-turn flow:

```
on POST /api/chat/send:
  parse body (message, conversationId, attachments)
  if message starts with "/":
    route as explicit tool call
  else:
    enter agent loop:
      for hop in 1..MAX_HOPS:
        response = await provider.streamWithTools(systemPrompt, history, tools)
        for chunk in response:
          if chunk.kind == "text":
            emit SSE "text"
            buffer text
          if chunk.kind == "function_call":
            emit SSE "tool_call"
            result = await executor.run(call)
            emit SSE "tool_result"
            if result.action:
              emit SSE "action"
            push tool_call + tool_result into history
            break inner loop, restart provider
        if response.finishReason == "stop":
          break outer loop
      save final assistant message + tool transcripts
      emit SSE "done"
```

`MAX_HOPS = 5` to prevent runaway tool-call loops. If hit, emit a friendly "Let me think about that more" message and stop.

---

## 6. What the UI needs to listen for (summary card for Codex)

```ts
type SageEvent =
  | { type: "conversationId"; conversationId: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, any>; status: "pending" }
  | { type: "tool_result"; callId: string; status: "success" | "error"; summary: string; data?: unknown }
  | { type: "action"; action: "navigate" | "open_form" | "open_resource" | "highlight"; target: string; label: string; meta?: Record<string, any> }
  | { type: "attachment_ack"; attachmentId: string; classification?: { kind: string; confidence: number; detectedFields?: Record<string, string> }; storagePath?: string }
  | { type: "done"; done: true; conversationId: string }
  | { type: "error"; error: string };
```

The chat-component switch on `event.type`, accumulates `text` chunks for streaming, and renders pills/cards for the structured events.

---

## 7. Open questions (need product input)

These don't block backend implementation but will shape Phase 2+:

1. **Confirmation UX granularity.** Always-confirm writes vs. confirm-on-significant vs. trust-with-undo? (Sage will start with always-confirm in Phase 2 by default.)
2. **Misclassification handling.** When `classify_attachment` returns low confidence (<0.7), should Sage refuse to file or ask the student? (Default: ask.)
3. **Teacher Sage scope.** Should teachers get a different toolset (bulk operations) or the student toolset + write privileges? (Default: separate toolset, gated by `requiredRoles`.)

---

## 8. Implementation status

- [ ] `src/lib/sage/agent/types.ts` — tool/call/result types
- [ ] `src/lib/sage/agent/tools.ts` — Phase 1 tool definitions
- [ ] `src/lib/sage/agent/executor.ts` — tool dispatcher
- [ ] `src/lib/sage/agent/loop.ts` — agent turn loop
- [ ] `src/lib/ai/provider.ts` — extend with `streamWithTools`
- [ ] `src/lib/ai/gemini-provider.ts` — implement function-calling stream
- [ ] `src/lib/ai/ollama-provider.ts` — implement function-calling stream (Phase 1.5)
- [ ] `src/app/api/chat/send/route.ts` — replace linear stream with agent loop
- [ ] `src/app/api/chat/slash-commands/route.ts` — slash command discovery endpoint
- [ ] `src/app/api/chat/attachments/route.ts` — attachment upload endpoint (if Option 3B)
- [ ] `src/lib/sage/system-prompts.ts` — teach Sage about her tools
