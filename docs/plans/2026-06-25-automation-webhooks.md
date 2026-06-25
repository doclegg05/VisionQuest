# Automation webhooks (n8n / Make / Zapier) — experiment

**Status:** experimental, behind `AUTOMATIONS_ENABLED` (off by default)
**Date:** 2026-06-25

## Goal

Let VisionQuest drive end-to-end workflows in external systems (staff
notifications, outcome reporting, intake) without building a bespoke
integration per system — by emitting **verified domain events** to an
automation platform that fans them out with pre-built connectors.

## The one decision that makes this safe

**Integrate at the event layer, not by handing Sage a generic automation tool.**

The LLM never triggers external automations. The backend fires them on real
state changes. This keeps automations deterministic and auditable, and keeps the
model — and prompt-injection — out of the blast radius. (Our red-team work shows
why a generic "call any webhook" tool would be a bad idea.)

```
verified backend event  ──▶  dispatchAutomationEvent()  ──▶  n8n/Make/Zapier
  (cert earned, concern,        (PII-strip, HMAC-sign,        (deterministic
   intervention flagged)         non-blocking POST)            workflow → email/
                                                               SMS/Slack/report)
```

## Privacy posture (the dominant constraint)

Students are TANF/SNAP recipients; `.claude/rules/security.md` forbids PII in
logs and mandates scrubbed payloads. Therefore:

- **Prefer self-hosted n8n.** Data stays in our infrastructure (run it next to
  the stack on Render/Docker). Make/Zapier are multi-tenant US cloud — data
  passes through them, so only use them for non-PII signals or with a DPA.
- **Payloads are pointers, not exports.** Events carry IDs + a deep link
  ("go look at this student in the app"), never names/emails/insight content.
  `stripPii()` enforces this in code via a key denylist, recursively — a
  careless caller cannot leak PII through a webhook.
- **Signed.** Every body is HMAC-SHA256 signed (`X-VisionQuest-Signature:
  sha256=<hex>`) with `AUTOMATION_WEBHOOK_SECRET` so the receiver verifies origin.

## What shipped in this experiment

- `src/lib/automation/dispatch.ts`
  - `dispatchAutomationEvent(type, data)` — flag-gated, PII-stripped, signed,
    5s-timeout, fire-and-forget, never throws. Returns a structured
    `DispatchResult` (`disabled` | `unconfigured` | `delivered` | `failed`).
  - Pure, tested helpers: `stripPii`, `buildEnvelope`, `signPayload`,
    `automationsEnabled`, `isKnownEventType`.
- **First wired event:** `student.concern.recorded` — fired from `recordInsight`
  when Sage records a `concern`-category insight (the highest-signal,
  staff-relevant case). Payload: `{ studentId, insightId, confidence, link }`.

## Event catalog (current)

| Event | Fired when | Payload (PII-minimal) |
|---|---|---|
| `student.concern.recorded` | Sage records a `concern` insight | `studentId, insightId, confidence, link` |
| `certification.earned` *(reserved)* | a cert is marked complete | `studentId, certificationId, link` |
| `intervention.flagged` *(reserved)* | a student enters the urgency queue | `studentId, urgencyScore, link` |

## Envelope shape

```json
{
  "id": "uuid",                       // idempotency key — dedupe on this
  "type": "student.concern.recorded",
  "occurredAt": "2026-06-25T15:00:00.000Z",
  "source": "visionquest",
  "data": { "studentId": "...", "insightId": "...", "confidence": 0.8, "link": "/teacher/students/..." }
}
```

Receiver verification (any platform): recompute `HMAC_SHA256(rawBody, secret)`
and compare to the `sha256=` value in `X-VisionQuest-Signature`.

## MVP to validate value

1. Stand up **self-hosted n8n** (Docker) with a Webhook trigger node.
2. Set `AUTOMATIONS_ENABLED=true`, `AUTOMATION_WEBHOOK_URL`, and a shared
   `AUTOMATION_WEBHOOK_SECRET` in Render env.
3. n8n verifies the signature → looks up the student via an **authenticated
   callback** to VisionQuest (so the sensitive detail never rides the webhook) →
   posts a "check in with this student" card to the staff Slack/Teams/email.
4. Measure: do staff act on it faster than the in-app queue alone?

## Next steps if it proves useful

- Wire `certification.earned` and `intervention.flagged`.
- Add a tiny authenticated read endpoint for workflows to resolve an ID → the
  minimal display fields they need (keeps PII on an authsaid channel).
- Lightweight delivery retry/backoff + a dead-letter log (today: best-effort).
- Optional inbound direction (external intake form → provision account) via a
  CRON_SECRET-style bearer on a dedicated endpoint.
