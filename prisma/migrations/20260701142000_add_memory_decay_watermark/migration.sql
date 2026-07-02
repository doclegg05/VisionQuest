-- Fix: the weekly decay UPDATE in /api/internal/memory/consolidate had no
-- watermark distinguishing "already decayed this cycle" from "never
-- decayed" — a double-invocation (manual re-run, retry) compounded the
-- 0.95x confidence multiplier instead of being a no-op. Additive only.

ALTER TABLE "visionquest"."SageMemory" ADD COLUMN "lastDecayedAt" TIMESTAMP(3);
