// =============================================================================
// Re-export of the one percentile implementation, for production `src/`
// code.
//
// `scripts/lib/percentile.mjs` is the canonical implementation (2026-08-20
// consolidation — see `.claude/MEMORY.md`'s Key Decisions Log). It lives
// under `scripts/` because its original callers were harness/report scripts;
// `src/lib/connect/funnel-shared.ts` (Match & Connect Phase 6) is the first
// PRODUCTION module to need it, and a relative `../../../scripts/lib/...`
// import from deep inside `src/` is exactly the kind of path a later file
// move breaks silently. This module is the one place that reaches across
// that boundary, so only this file's import needs fixing if the scripts/
// implementation ever moves.
// =============================================================================

export { percentile } from "../../scripts/lib/percentile.mjs";
