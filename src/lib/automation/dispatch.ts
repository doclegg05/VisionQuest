/**
 * Outbound automation webhooks (experiment — see
 * docs/plans/2026-06-25-automation-webhooks.md).
 *
 * Lets VisionQuest notify an external automation platform (self-hosted n8n
 * preferred; Make/Zapier possible) when a verified DOMAIN EVENT happens — so a
 * deterministic workflow can fan it out to email/SMS/Slack/reporting. The LLM
 * never triggers these: the backend fires them on real state changes, which
 * keeps automations auditable and keeps the model out of the blast radius.
 *
 * Safety properties enforced HERE (not by convention):
 *  - OFF by default. Requires AUTOMATIONS_ENABLED=true + a URL + a secret.
 *  - PII-minimal. A denylist strips name/email/phone/content/etc. before send;
 *    the payload is a "go look in the app" pointer (IDs + a link), never the
 *    sensitive content itself. Students are TANF/SNAP recipients — this is the
 *    point of the whole design.
 *  - HMAC-signed (sha256 over the raw body) so the receiver can verify origin.
 *  - Non-blocking + never throws into the caller (fire-and-forget).
 */

import { createHmac, randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";

export const AUTOMATION_EVENT_TYPES = [
  "student.concern.recorded",
  "certification.earned",
  "intervention.flagged",
] as const;
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

export function isKnownEventType(type: string): type is AutomationEventType {
  return (AUTOMATION_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Keys we refuse to send to a third party, at any nesting depth. The dispatcher
 * strips these so a careless caller can't leak student PII through a webhook.
 */
const PII_DENYLIST = new Set([
  "name",
  "displayname",
  "firstname",
  "lastname",
  "email",
  "phone",
  "content",
  "summary",
  "notes",
  "address",
  "ssn",
  "dob",
  "dateofbirth",
  "passwordhash",
  "geminiapikey",
]);

/** Recursively drop denylisted keys. Pure; returns a new object. */
export function stripPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPii);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_DENYLIST.has(k.toLowerCase())) continue;
      out[k] = stripPii(v);
    }
    return out;
  }
  return value;
}

export interface AutomationEnvelope {
  /** Idempotency key — receivers should dedupe on this. */
  id: string;
  type: AutomationEventType;
  occurredAt: string;
  source: "visionquest";
  data: Record<string, unknown>;
}

/** Build the wire envelope. Pure (id + occurredAt injected for testability). */
export function buildEnvelope(
  type: AutomationEventType,
  data: Record<string, unknown>,
  id: string,
  occurredAt: string,
): AutomationEnvelope {
  return {
    id,
    type,
    occurredAt,
    source: "visionquest",
    data: stripPii(data) as Record<string, unknown>,
  };
}

/** HMAC-SHA256 of the raw body, hex, prefixed for header use. Pure. */
export function signPayload(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function automationsEnabled(): boolean {
  return process.env.AUTOMATIONS_ENABLED?.trim().toLowerCase() === "true";
}

export type DispatchResult =
  | { status: "disabled" }
  | { status: "unconfigured" }
  | { status: "delivered"; httpStatus: number }
  | { status: "failed"; httpStatus?: number; error?: string };

const TIMEOUT_MS = 5000;

/**
 * Fire a domain event at the configured automation webhook. Fire-and-forget:
 * callers should `void` this so it never blocks or breaks the request. Returns
 * a structured result (useful in tests / future retry logic).
 */
export async function dispatchAutomationEvent(
  type: AutomationEventType,
  data: Record<string, unknown>,
  opts: { eventId?: string; occurredAt?: string } = {},
): Promise<DispatchResult> {
  if (!automationsEnabled()) return { status: "disabled" };

  const url = process.env.AUTOMATION_WEBHOOK_URL?.trim();
  const secret = process.env.AUTOMATION_WEBHOOK_SECRET?.trim();
  if (!url || !secret) {
    logger.warn("Automation event not sent — webhook URL/secret not configured", { type });
    return { status: "unconfigured" };
  }

  const envelope = buildEnvelope(
    type,
    data,
    opts.eventId ?? randomUUID(),
    opts.occurredAt ?? new Date().toISOString(),
  );
  const body = JSON.stringify(envelope);
  const signature = signPayload(body, secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VisionQuest-Event": type,
        "X-VisionQuest-Signature": signature,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("Automation webhook returned non-2xx", { type, httpStatus: res.status });
      return { status: "failed", httpStatus: res.status };
    }
    logger.info("Automation event delivered", { type, eventId: envelope.id });
    return { status: "delivered", httpStatus: res.status };
  } catch (err) {
    logger.warn("Automation webhook delivery failed (non-fatal)", {
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
