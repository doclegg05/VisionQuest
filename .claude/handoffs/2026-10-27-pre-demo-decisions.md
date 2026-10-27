# Pre-demo decisions — 2026-10-27

Owner approved four decisions on 2026-10-26 and confirmed the follow-ons with
"Yes to all" on 2026-10-27. Recorded on `codex/Supabasedesign-integrate` for #288:

- Coordinator D2: frozen at `/coordinator` only; reopen on an actual coordinator
  need. Scope authority: `docs/PRODUCT_DECISIONS.md`. The known RLS defect and
  unverified active-account count remain readiness conditions.
- Keep SPOKES role colours. Intake, verify-document, admin home and teacher home
  need light/dark preview signoff before merge. That review remains pending.
- Accept current cohort packet export for demo/single-site pilot; streaming and
  per-staff rate limiting must precede a second site. Reassess earlier if pilot
  export volume/concurrency increases. Tracked in Open Items.
- Preserve task/dashboard response contracts; new route families require the
  envelope. The exact exception is in `.claude/rules/api-conventions.md`.

Independent gpt-6.1-sol review: round 1 requested narrower envelope wording in
Open Items; fixed. Round 2 returned APPROVE for scoped decision docs with no open
findings. This is not approval of the broader PR, build, or deployment.

Validation: `git diff --check`, `npm run memory:validate`, and nine existing
coordinator-nav/export-route tests passed. No runtime code changed. No production
account query, migration, release, or visual signoff was performed in this pass.

Review base: `9c414f4018aa6f58017ddb1c7533821b8f805f4b`; prior branch head
`a80db652d26fa1ed236aa559bc8b6cc4d4c459b2`. Prior implementation/evidence handoff:
`.claude/handoffs/2026-10-26-pre-demo-refinement.md`.
