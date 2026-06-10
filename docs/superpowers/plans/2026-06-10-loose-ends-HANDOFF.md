# HANDOFF — Post-Launch Loose Ends (resume here in a fresh session)

> Context: the chat-first rebuild is COMPLETE — all 6 phases merged (PRs #66–#75),
> production healthy. This file hands off the 4 remaining loose-end items.
> **Branch `chore/loose-ends` exists and is pushed**, off main (44e432d), with
> item 1 partially done (1 WIP commit). User instruction: work these in a loop
> until all are merged, then report. Work INLINE — background agents stall.

## Read first
- `CLAUDE.md` + `.claude/rules/*.md` (conventions), `.claude/MEMORY.md` (state + gotchas)
- Master plan: `docs/superpowers/plans/2026-06-09-chat-first-rebuild-master-plan.md`

## Critical gotchas (will bite you)
1. **NEVER `prisma migrate dev`** — it resets the shared Supabase dev DB. Hand-author
   migration SQL + `npx prisma migrate deploy` + `npx prisma generate`.
2. **block-no-verify commit hook false-positives**: never put `git commit` in the same
   Bash command as anything with a `-n` flag (`grep -n`, `sed -n`). Split commands.
3. Port 3000 is occupied by an unrelated app. E2E:
   `BASE_URL=http://localhost:3100 PORT=3100 npx playwright test` (config honors both).
4. Evals are HARD gates before merging Sage-affecting changes:
   `npm run sage:rag:harness -- --strict-clean` (40/40 strict, ≥80% clean),
   `npm run sage:memory:eval` (<5% dup), `npm run sage:agent:eval` (0 injection failures).
5. Full gates before PR: `npm test` (983+ pass) · `npx eslint .` · `npm run typecheck` ·
   `npm run build`.

## Item 1 — Staff-assisted tool confirmations (PARTIALLY DONE)
Goal: a teacher proposing a Sage action for a student (ctx.targetStudentId) can confirm
it; tokens bind the target so cross-target confirmation is impossible.

DONE (committed on branch):
- `src/lib/sage/agent/confirmation.ts`: `ConfirmationPayload.targetStudentId?` added and
  included in the HMAC material (`payload.targetStudentId ?? ""`).
- `src/lib/sage/agent/write-tools.ts`: `confirmationGate` payload includes
  `targetStudentId: ctx.targetStudentId`; proposal `meta` includes `targetStudentId`.

REMAINING:
- `src/lib/sage/agent/career-tools.ts`: `propose_resume_edit` builds its own payload
  (search `const payload = {`) — add `targetStudentId: ctx.targetStudentId` for
  consistency (tool is student-only so it's always undefined, but the verify in the
  gate and the route must hash identically).
- `src/app/api/chat/tool-confirm/route.ts`: zod schema add
  `targetStudentId: z.string().cuid().optional()`; pass it into BOTH
  `verifyConfirmationToken` payload AND `executeAgentTool({ ..., targetStudentId })`.
  SECURITY: only allow `targetStudentId` when `isStaffRole(session.role)` — reject a
  student supplying one (`badRequest`).
- `src/components/chat/ConfirmToolCard.tsx`: include `targetStudentId: meta.targetStudentId`
  in the POST body (undefined fine).
- Tests in `src/lib/sage/agent/write-tools.test.ts` (mock patterns already there):
  (a) token created WITH targetStudentId "stu-2" + confirm WITHOUT it → proposal again,
  no write; (b) teacher session + targetStudentId token round-trip → executes, and the
  prisma mocks receive `studentId: "stu-2"` in the ownership lookups; (c) student
  passing targetStudentId to tool-confirm route → 400 (route-level test optional; at
  minimum document in code).
- Run unit tests + full gates, commit.

## Item 2 — One-curl prod embedding backfill
- New `src/app/api/internal/rag/backfill/route.ts`: copy the auth pattern from
  `src/app/api/internal/memory/consolidate/route.ts` (Bearer CRON_SECRET, prismaAdmin
  NOT needed here — reuse the backfill flow). Extract the per-doc embed loop from
  `scripts/backfill-embeddings.mjs` into a shared lib
  (`src/lib/sage/backfill-embeddings.ts` exporting `backfillProgramDocumentEmbeddings({ force })`
  returning the tally) and have BOTH the script and the route call it. Route accepts
  optional `{ force?: boolean }`. Long-running: ~50 docs ≈ 1-2 min — fine for one call;
  set `export const maxDuration = 300` if needed.
- DEPLOY.md: replace the "Render shell" instruction with:
  `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"`
- Tests: lib-level (mock prisma/storage/embeddings) for skip/force/no-text tallies.

## Item 3 — Honest accessibility measurement
- Start server: `PORT=3100 npm run dev` (background) or reuse e2e webServer.
- `npx lighthouse http://localhost:3100/ --only-categories=accessibility --output=json --output-path=.planning/a11y-landing.json --chrome-flags="--headless"`
  (also `/teacher-register`, any public pages). For authenticated pages, add
  `@axe-core/playwright` checks inside the existing e2e specs if a seeded login exists
  (`npm run db:seed` creds — check scripts/seed-data.mjs); otherwise measure public pages
  and record honestly.
- Record scores in `docs/superpowers/plans/2026-06-10-a11y-results.md`. Fix cheap finds
  (labels, contrast, landmarks). Target ≥90; report actual numbers either way.
- Update `.claude/MEMORY.md` open item with the measured score.

## Item 4 — Scheduled removal of /dashboard/classic
- `gh issue create --title "Remove /dashboard/classic after chat-first parity window" --body "...due ~2026-07-10 (one release after 2026-06-10 launch). Remove src/app/(student)/dashboard/classic/, the AmbientPanels 'Classic view' link, and the DashboardClient if unused elsewhere."`
- Do NOT remove the route now (parity promise made at launch).

## Finish
- One PR from `chore/loose-ends`: "chore: post-launch loose ends (staff confirmations,
  one-curl backfill, a11y measurement, classic-removal schedule)". CI (`verify`) must
  pass → squash-merge → confirm prod 200 → update `.claude/MEMORY.md` Open Items and
  the auto-memory file `~/.claude/projects/-Users-brittlegg/memory/project_visionquest_chat_first_rebuild.md`.
- Still user-owned afterward: trigger the backfill curl (needs CRON_SECRET), optional
  COS_USER_ID/COS_API_TOKEN in Render.
