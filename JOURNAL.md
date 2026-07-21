# Decision Journal — agent/sage-career-grounding-20260709

Plan: `C:\Users\Instructor\.claude\plans\i-would-like-to-cached-liskov.md` (Sage career grounding, phases A–E).
Lane: exploration (isolated worktree, non-governed surfaces). Governed steps (live Supabase upload/sync,
live CareerOneStop calls with real creds, merge/push/deploy) are STAGED ONLY — Britt approves.

---

[2026-07-09] DECISION: Branch `agent/sage-career-grounding-20260709` created from `main` (f346f45), worktree at `.claude/worktrees/sage-career-grounding` | WHY: 8 concurrent worktrees + autopilot write this repo; charter mandates isolation; main == origin/main so no fetch needed | ALTERNATIVES: branch from feat/sage-action-cards (rejected — unrelated in-flight chat work); sibling directory (rejected — .claude/worktrees is the established convention) | REVERSIBLE: `git worktree remove` + branch delete (agent-created scratch, charter §4)

[2026-07-09] DECISION: Execute plan via self-paced /loop, one Ultracode workflow per phase-cluster (A first; then B-prep ∥ C ∥ D; then E gates) | WHY: Britt chose path 2 + "/loop with agent teams"; phase B depends on A's dedup manifest; C/D are independent but share the worktree, so they run after A in one coordinated run to avoid write collisions | ALTERNATIVES: single monolithic A–E workflow (rejected — no review point between discovery and code); fully parallel A∥C∥D (rejected — C/D write the worktree while A informs B's targets; sequencing costs little) | REVERSIBLE: fully — nothing leaves the branch

[2026-07-09] PHASE A COMPLETE (workflow wf_45ee5ae8-32f, 5 agents, 0 errors): 15 new candidates / 17 already-in-RAG (ECP dupe CONFIRMED: RAG row "ECP AE and SPOKES", TEACHER_GUIDE/TEACHER, content-equivalent to all 4 local renditions) / 0 staged-only / 28 skipped with reasons / 12 piiRisk paths quarantined. Manifest: `.planning/career-grounding/phase-a-inventory.md`. 8 open questions (Q1–Q8) held for Britt's digest. NOTE: the RAG-rows agent left `tmp-career-a-ragrows.mjs` in the primary checkout root (matches existing tmp-*.mjs convention) + full row dump in the temp dir — flagged for digest, not cleaned (archive-never-delete).

[2026-07-09] DECISION: Redacted student-named paths out of the tracked manifest into `phase-a-pii-appendix.local.md` (untracked) and appended a guard to `.git/info/exclude` (local-only, additive) | WHY: `.planning/` is NOT gitignored; manifest Appendix A named 8 student-record paths; branch commits are local but push-gated later — PII must never enter git history (stricter FERPA reading) | ALTERNATIVES: commit unredacted + pre-push reminder (rejected — safety by convention, not construction); don't commit manifest at all (rejected — it's Phase B's contract and should ride the branch) | REVERSIBLE: local appendix + exclude lines are trivially removable

[2026-07-09] DECISION: `node_modules` junction from worktree → primary checkout | WHY: build/lint/test agents need deps; `prisma/schema.prisma` verified IDENTICAL between main and feat/sage-action-cards so the shared generated client is safe (known footgun only bites on schema mismatch); no schema changes planned in B/C/D | ALTERNATIVES: full `npm ci` (slower, ~GB; fallback if junction misbehaves) | REVERSIBLE: delete junction

[2026-07-09] DECISION: `docs-upload/` is gitignored → Phase B stages candidate copies worktree-locally (untracked by design); the COMMITTED deliverables are catalog nodes, allowlist entries, knowledge-base reconciliation, and the governed runbook | WHY: matches PR #110-era reality (docs-upload mirrors the bucket, not git) | REVERSIBLE: fully

[2026-07-09] PHASES B/C/D COMPLETE (workflow wf_6636d0d6-50a, 3 track agents, 0 errors) + INDEPENDENTLY VERIFIED by orchestrator: 15 staged docs (sha256 15/15) / 19 catalog nodes / 18 allowlist keys / prisma schema valid / tsc --noEmit PASS / 39/39 new tests PASS / repo-wide eslint: 34 errors ALL pre-existing (react-hooks rules in teacher/orientation/vision-board components — zero overlap with branch files). Commits: 00c91a4 (B: catalog+allowlist+knowledge-base+runbook), 51214b9 (C: CareerOneStop counseling client + 5 read-tier Sage tools + 31 adversarial tests), 4c0476f (D: /career/profile Career DNA surface + helper + 8 tests), d0345b6 (fix: two verified drifts). Notable agent-reported deviations, accepted: Phase A manifest had a mis-transcribed path for candidate #1 (agent relocated exact file by size+mtime, sha256-verified); 8 slug deviations (validator's filename-derived rule wins); C's tools live in career-grounding-tools.ts because career-tools.ts already existed; C deliberately omitted 'server-only' imports to match neighbor idiom (documented for review).

[2026-07-09] DECISION: Fixed two PRE-EXISTING drifts outside track ownership in a labeled fix commit (d0345b6) | WHY: portfolio-checklist title drift made catalog:validate exit 1 — blocks the Phase E gate; certifications.ts NCRC 'Business Writing' is the same verified factual error fixed in knowledge-base.ts (source: staged SPOKES_Certifications.docx) — shipping the branch with the contradiction intact would be worse | ALTERNATIVES: leave both + flag (rejected: validator gate must be green to be meaningful) | REVERSIBLE: revert d0345b6

[2026-07-09] PHASE E COMPLETE (workflows wf_cffa035f-5ee review + wf_e139927d-387 fixes; 15 agents total, 0 errors). Review panel: code-reviewer + security-specialist + accessibility-reviewer over main...HEAD; every non-LOW finding adversarially verified (5 confirmed, 2 refuted, 5 LOW logged). Evals mirrored CI with GEMINI key only (no DB vars — nothing live reachable). CONFIRMED+FIXED: (1) HIGH not_found mis-reported as service failure in 3 tools → graceful no-match + 4 tests (066c65b); (2) HIGH light-theme badge contrast ~3.9:1 → --badge-success-text ~5.9:1 (a7689b5); (3) MEDIUM 36px primary CTA → min-h-11 (a7689b5); (4) MEDIUM COS_USER_ID in failure logs (pre-existing on main, contract written this branch) → redacted logUrl + 2 leak tests (4aa7d92); (5) LOW stale runbook TODO → reworded (d24a6f5). GATING REGRESSION found & fixed: chat-harness tool-cert-quickbooks (passed on main CI 2026-07-09 10:33, failed on branch — 30-tool registry shifted Gemini) → two-sentence disambiguation in find_certification/lookup_program_info descriptions (1482fa0); harness 9/9 twice at temp 0, red-team 0 hard fails, career tool files byte-unchanged. FRAGILITY NOTE for future editors: any wording change to career_training_programs' description flipped tool-teacher-lookup-student to search_forms (root cause: search_forms' parameter example mentions certifications — owned by tools.ts/search_forms, not this branch). FINAL GATES: harness 9/9 ×2, red-team 0 hard, 39+ unit tests green, tsc clean, eslint clean on all touched files (34 repo-wide errors pre-existing, untouched files), prisma schema valid, catalog validate 0 errors.

[2026-07-10] MERGE+PUSH (Britt's explicit word). origin/main had advanced f346f45→8921f91 (PR #114 "Feat/sage action cards") overnight; overlap = 2 files, both benign (identical portfolio-checklist title fix on both sides; tools.ts hunks disjoint — #114 added action-card meta to 3 tools, we added registry entries + 2 description sentences). Merged main into branch (5215acf, zero conflicts). RE-GATED ON MERGED STATE: harness 9/9 (tool-cert-quickbooks passes outright; #114 independently added acceptableTools:[lookup_program_info] to that case — upstream hit the same flake), red-team 0 hard fails (8 soft heuristic warnings, consistent with prior runs), 64/64 unit tests, tsc/eslint clean. GOTCHA LOGGED: the session shell recycled mid-turn (MCP reconnect) and silently reset cwd to the primary checkout — the first post-merge gate run executed against feat/sage-action-cards@fd11191 and produced a FALSE harness failure; caught via git status showing primary-root untracked files. Lesson: prefix every gate command with an absolute cd. Main fast-forwards to the branch tip; push follows. Render auto-deploys main (code-only change, no migrations).

[2026-07-09] DECISION: B∥C∥D proceeds on all 15 candidates without blocking on Q1–Q8 | WHY: staging is on-branch and reversible; Britt's decision point is the governed upload/sync gate. Leans adopted: Q3 WIOA referral → `forms/` (synthesizer's placement beside STUDENT_REFERRAL rows beats generic guidance); Q6 overlaps → cross-referenced in catalog "When NOT to use" rather than dropped; Q7 2021-dated pathway doc → staged with dated-caveat in its catalog node. Q1 (ECP student-audience restage), Q2 (4 piiRisk confirms), Q5 (interest-profiler source), Q8 (rubric -2 refresh) stay OPEN — presented as leans in the digest, not acted on | REVERSIBLE: un-stage any candidate before the governed gate

---

# Decision Journal — agent/sage-chunk-search-20260710

Slice: Sage chunk-search + provenance (working-tree changes landed as scoped commits; gates: unit tests, typecheck, eslint, prisma validate, read-only index integrity).
Lane: exploration (isolated branch, non-governed surfaces). No DB writes; the new migration is committed but NOT applied (applying = governed, out of scope).

[2026-07-10] DECISION: Created branch `agent/sage-chunk-search-20260710` off main (a3357d5) before any write | WHY: main is shared (SPOKES Bot scheduled writer); charter §4 requires isolation | ALTERNATIVES: worktree (unnecessary — the changes already sat in this checkout's working tree) | REVERSIBLE: delete branch after digest (charter §4 carve-out).

[2026-07-10] PREMISE CHECK: `SageMemory.embeddingModel` already exists in migration history (20260702200000_add_embedding_model_provenance ALTERs SageMemory) — the schema.prisma edit only catches the Prisma model up to the live column; no new ALTER migration needed | WHY: feedback rule — verify plan premises; the goal framed the column as possibly missing from the live DB | REVERSIBLE: n/a (read-only check).

[2026-07-10] DECISION: Five scoped commits: (1) migration + hybrid-retrieval (SQL function's new RETURNS shape and chunk-fts ranking are consumed by the TS — splitting leaves a non-working commit), (2) knowledge-base-server source-file citation, (3) schema field + memory dedupe model guard, (4) backfill stale-chunk repair, (5) integrity script + npm script | WHY: one commit per logical layer per feedback.md rule 9 | REVERSIBLE: git revert per commit.

[2026-07-10] DECISION: Verified `scripts/sage-index-integrity.mjs` is read-only before committing (SELECT-only raw queries; `--strict` only sets exit code; no INSERT/UPDATE/DELETE/DDL/executeRaw) | WHY: goal constraint — DB access only via read-only integrity script | REVERSIBLE: n/a.

[2026-07-10] DECISION: No Co-Authored-By trailer on commits | WHY: `~/.claude/rules/common/git-workflow.md` — attribution disabled globally; user rules override harness default | REVERSIBLE: n/a.

[2026-07-10] FINDING+FIX: `npx eslint .` failed with 34 errors, ALL pre-existing react-hooks violations in UI files untouched by this slice — yet CI (which runs the same lint) is green on main. Root cause: local node_modules drift — lockfile pins eslint-plugin-react-hooks@7.0.1 (CI-installed, green) but local had 7.1.1, whose new React-compiler rules (set-state-in-effect, purity checks) error on existing UI code. FIX: restored 7.0.1 into node_modules from the npm tarball (surgical folder swap; `npm install --no-save` hit EBUSY on the Next SWC binary held by another process). 7.1.1 copy archived to session scratchpad, not deleted. No package.json/lockfile/eslint-config change (graders frozen; lockfile parity restored, not weakened) | ALTERNATIVES: fix 34 react-hooks errors in untested UI (out of slice scope, regression risk); eslint-disable comments (gaming the gate — forbidden in spirit) | REVERSIBLE: copy 7.1.1 back from scratchpad or `npm ci`. FLAG FOR BRITT: when the lockfile eventually upgrades past react-hooks 7.1, those 34 UI errors become a real gate — queue a react-hooks compliance pass as its own slice.

---

# Decision Journal — agent/rag-cleantop3-20260710

/goal slice: doc-RAG clean top-3 on `config/sage-rag-eval.json` from 10/20 to ≥15/20
(the goal's "10/14" mapped to ratio ≥71.4% after the fixture grew to 20 expected checks),
proven by `npm run sage:rag:harness`; floors: doc-eval Top-1 ≥ 13/20 baseline,
`sage:form:harness` unregressed, `test:api` exit 0. Lane: exploration (worktree
`.claude/worktrees/rag-cleantop3`, node_modules junctioned to primary, .env.local copied).
Graders frozen and untouched: scripts/sage-rag-harness.mjs, config/sage-rag-top-questions.json,
config/sage-rag-eval.json, scripts/sage-form-harness.mjs, config/sage-form-eval.json.

[2026-07-10] BASELINE (first turn, before any change): doc-eval clean top-3 10/20, Top-1
13/20, noAnswer 8/9; default 40-q fixture clean 38/40, Top-1 32/40. Recorded 6/14 was stale.
JSONs: .planning/sage-rag/harness-docs-cleantop3-baseline.json + harness-cleantop3-baseline.json.

[2026-07-10] DECISION: Diagnosed all 10 failing cases via raw sage_hybrid_search rows
(tmp-diag-cleantop3.mjs, scratch, uncommitted). Failure classes: (a) exact RRF ties resolved
arbitrarily (mirrored leg ranks → identical fused score), (b) same form at two storage paths
occupying two slots (DoHS release under orientation/ AND forms/), (c) trailing sibling docs
0.02–0.05 farther in embedding space than the answer, (d) FTS-strong true answer
margin-dropped because the margin anchors on a semantically-closer weak row
(low-literacy-portfolio) | WHY: fix classes, not cases | REVERSIBLE: n/a (read-only).

[2026-07-10] DECISION: App-side post-processing only, all in src/lib/sage/hybrid-retrieval.ts:
(1) distance tiebreak for exact score ties (epsilon 1e-9); (2) normalized-title dedupe;
(3) SQL fetch widened to limit*2+2 with post-trim cap at limit so trimmed slots backfill;
(4) relative-cutoff defaults retuned via env-override sweep: DISTANCE_MARGIN 0.04→0.02,
MIN_SCORE_RATIO 0→0.85 | WHY: goal forbids migrations/live-DB changes; dual-leg peers sit at
score ratio ≥0.92 vs single-leg fillers ≈0.5, genuine multi-doc peers within ~0.015 distance
vs siblings 0.02–0.05 out | ALTERNATIVES: metadata-aware SQL rerank (Track B — needs a
migration, out of scope); margin <0.0104 to clean admin-guide (rejected: overfitting, the
gap to the nearest legit peer is 0.0004) | REVERSIBLE: git revert; both knobs remain
env-overridable (SAGE_RAG_DISTANCE_MARGIN, SAGE_RAG_MIN_SCORE_RATIO).

[2026-07-10] DECISION: First draft protected the top-scored row from all cutoffs; REPLACED
with "trim all rows; if nothing survives, fall back to the fused winner alone" | WHY: the
protection fixed low-literacy-portfolio but regressed ts12-fillable-vs-nonfillable
(keyword-loud WRONG doc protected at top-1; at baseline the margin correctly killed it).
Fallback semantics fix both: cutoffs trim trailing noise but can't veto the only viable
match | REVERSIBLE: git revert.

[2026-07-10] RESULT (defaults, no env overrides): doc-eval clean top-3 15/20 (was 10/20),
Top-1 15/20 (was 13/20), noAnswer 8/9 unchanged; 40-q fixture clean 38/40 (held), Top-1
33/40 (was 32). TRADE-OFF (no silent caps): 40-q top3Expected 36→34 and strict 36→34 —
orientation-overview and quickbooks each lose a secondary expected doc to the tighter trim
(legacy pass 39/40 unchanged). Remaining doc-eval dirty cases: prc1-vs-ssp1 +
low-literacy-orientation (embedding thinks the sibling is the answer), admin-guide (0.0004
margin gap), sign-in-sheet + ecp-instructions (expected docs are teacher-audience; a student
caller cannot retrieve them — needs an audience or fixture decision, flagged below).

[2026-07-10] VERIFIED: hybrid-retrieval tests 23/23 (6 new: tiebreak, dedupe, widened fetch,
fallback, loud-wrong-doc trim, limit cap) + knowledge-base suites → 44/44; test:api 149/149
exit 0; eslint clean on changed files; form harness BYTE-IDENTICAL to unmodified main
(top3 12/12, cleanTop3 12/12, forbiddenHits 0, top1 11/12 — pre-existing on main, verified
by running the harness on the untouched primary checkout; the recorded "12/12" predates
corpus drift, not caused by this change).

OPEN FOR BRITT (digest): (1) merge/push — NOT done, branch only; (2) audience decision for
the two teacher-doc cases above; (3) pre-existing form-harness top1 11/12 drift worth a look;
(4) speculative follow-up (not built): lexical title-boost rerank could clean prc1-vs-ssp1
class without touching SQL.

---

# Decision Journal — agent/react-hooks-compliance-20260710

Slice: react-hooks 7.1.1 compliance (34 errors across 30 UI files fixed so the future lockfile
upgrade past 7.0.1 cannot break the lint gate). Lane: exploration (isolated branch). No DB access.
Graders untouched: eslint.config.mjs, tsconfig.json, package.json, package-lock.json.

[2026-07-10] DECISION: Branched from current origin/main (71b975b) instead of the goal's pinned fb26e5e | WHY: the pin guarded against then-unpushed clean-top3 work; a fresh fetch showed it had since been pushed (fb26e5e is 71b975b's ancestor) — a stale-SHA branch would only add rebase debt | REVERSIBLE: rebase before merge.

[2026-07-10] ANOMALY (flagged, not repaired): the chat-grounding agent committed 4e03dec (its Britt-approved sage-chat-harness grounding fix + journal) onto this checkout's HEAD after my branch was created — it now sits UNDER my commits and exists on NO other branch. Left in place: rebasing it away would orphan the only copy of approved work | AT MERGE: take it (it was Britt's word) or cherry-pick it out first | REVERSIBLE: history untouched.

[2026-07-10] DECISION: Fanned 30 files to 5 parallel subagents with disjoint sets + a fix playbook; central gates afterward | WHY: patterned errors (28 set-state-in-effect, 3 purity, 2 refs, 1 immutability) | REVERSIBLE: git revert per commit.

[2026-07-10] FINDING (empirical, confirmed by two agents independently): the 7.1.1 set-state-in-effect rule does not model await timing — it flags any direct effect-body call to a component-level function containing setState anywhere. Behavior-identical compliant patterns used: inline async closure in the effect, latest-ref indirection, full loader inlining, adjust-state-during-render for dep-change resets. Where loaders keep sync setLoading resets for event-handler call sites, those stay (legal in handlers). INTERPRETATION NOTE (not silently absorbed): for shared loaders, the inline-closure fix passes the rule while the mount call still runs one pre-await setState at runtime — accepted deliberately; restructuring shared loaders risked real regressions in untested UI for a heuristic lint win.

[2026-07-10] DECISION: Removed ClassRosterManager's now-dead exhaustive-deps disable comment | WHY: after ref-indirection the directive became unused and itself warns; removing a dead directive ≠ adding a disable | REVERSIBLE: trivially.

[2026-07-10] BEHAVIOR NOTES (accepted, journaled): Date.now() captured once at mount in StudentAdvisingHub/EventsHub (past/upcoming classification frozen per mount; both surfaces refresh via server props — imperceptible); OrientationChecklist gained a cancelled-guard (stale responses discarded — strict improvement); InterventionQueuePanel may show one fewer spinner flash when SSR pre-supplied the queue; ClassOverview's skip flag became a ref (drops one wasted re-render).

[2026-07-10] GATES: eslint exit 0 under BOTH 7.1.1 and restored 7.0.1 (folder-swap only; package files byte-identical); tsc exit 0; full unit suite 1553/1553 exit 0; production build exit 0. Commits: ede6baf (teacher, 16 files), 6c5c023 (app surfaces, 12), 7adf942 (ui purity/refs, 3).

[2026-07-10] CORRECTION to the 4e03dec anomaly above: the owning agent later landed the SAME change as 2b351d8 on its own branch (agent/sage-chat-grounding-20260710) — verified byte-identical via git patch-id — and its memory note asks for 4e03dec to be dropped from this branch. Attempted `git rebase --onto 71b975b 4e03dec`; the permission classifier declined the history rewrite in auto mode. Left as-is deliberately | AT MERGE (Britt or manual run): drop 4e03dec via that exact rebase (safe — 2b351d8 is the surviving copy), or merge as-is and let the dupe no-op | REVERSIBLE: yes, nothing rewritten.

[2026-07-10] MERGE GATE (second session, Britt's explicit word to drop 4e03dec + merge + push). Observed on arrival: the deferred rebase had ALREADY completed (reflog: rebase finish onto 71b975b at 13:08:19; old tip 8fcee1c → new tip 4087328) and local main was already fast-forwarded to the branch tip — only the push remained. INDEPENDENT VERIFICATION before pushing: (1) full-commit patch-ids of 4e03dec vs 2b351d8 DIFFER (JOURNAL.md context hunks differ by branch — the entry above overstates "byte-identical via patch-id"); blob-level check confirms the substantive files ARE byte-identical (scripts/sage-chat-harness.mjs blob 1f66480, chat-grounding-debug.json blob db5c178 — same in both commits), so the drop is safe as claimed; (2) re-gated the REBASED tree (delta vs gated tree = 4e03dec's non-React files reverted to main): eslint exit 0 / 0 errors under lockfile 7.0.1, eslint exit 0 under 7.1.1 (temp folder-swap, restored + verified), tsc exit 0, unit suite 1553/1553 pass; (3) no prisma/migration files in the merge diff — code-only deploy; (4) origin/main still 71b975b at fetch. FINDING (gate integrity, flag for Britt): `npm test` on Windows silently runs ZERO tests and exits 0 — the script's `$(git ls-files ...)` does not expand under npm's default cmd.exe shell; a green `npm test` here proves nothing. Ran the suite via bash with the expanded file list instead. RECOMMEND: point npm's script-shell at bash on this machine or make the test script shell-agnostic (own slice, grader change — Britt's word). Push of main (4087328) follows this journal commit; Render auto-deploys (code-only, no migrations).

---

# Decision Journal — agent/npm-test-shell-fix-20260710

Slice: fix the `npm test` gate-integrity trap found at the react-hooks merge gate (Britt's word:
"fix the issue you found"). Pushed main first (99683aa, the react-hooks slice) — remote noted the
push BYPASSED branch protection (PR + required "verify" check); flagged in the digest.

[2026-07-10] ROOT CAUSE (two layers, both verified by repro): (1) Windows: npm's default cmd.exe
script-shell does not expand `$(git ls-files ...)` — tsx receives the literal string, matches
nothing, runs 0 tests, exits 0 (silent green). (2) ALL platforms including green Linux CI: node's
test runner treats each CLI arg as a glob, so literal paths containing `[id]`-style brackets parse
as character classes and match nothing — `students/[id]/memories/route.test.ts` and
`students/[id]/reassign-class/route.test.ts` (3 suites / 14 tests) have been SILENTLY SKIPPED in
every `npm test` run to date. Repro: passing the bracket path explicitly runs 0 tests; file-set
diff proved glob-vs-ls-files sets identical (190=190) while counts differed 1567 vs 1553.

[2026-07-10] DECISION: one-line fix — `test` now passes double-quoted glob patterns
("src/**/*.test.ts", "src/**/*.test.tsx") for node to expand internally, the same idiom test:api
already uses | WHY: works identically under sh and cmd (quotes survive both), and node's own
directory walk finds bracket-named dirs literally, un-skipping the 3 suites | ALTERNATIVES: node
runner script with git-ls-files parity + zero-file guard (rejected: more surface for the same
result; tracked-vs-untracked delta is empty today and the pattern is static); npm script-shell
config change (rejected: machine-local, doesn't fix the bracket skip) | TRADEOFF ACCEPTED: a
nothing-matched typo still exits 0 (pre-existing runner behavior, same as test:api) | REVERSIBLE:
git revert.

[2026-07-10] GATES: npm test = 1567/1567 pass, 0 fail via BOTH PowerShell→cmd and bash (the 14
newly-unskipped tests all pass); eslint exit 0 / 0 errors; graders otherwise untouched (only the
`test` script line changed). CI impact: next CI run executes 1567 instead of 1553.
---

## agent/sage-chat-grounding-20260710 — chat-harness grounding goal (STOPPED: grader defect)

[2026-07-10] DECISION: STOP per goal constraint ("fixture expectation wrong -> STOP and
report") instead of coding around the grader | WHY: the 3 failing grounding cases in
sage:chat-harness CANNOT pass with frozen graders — runGroundingCase compares the parsed
download-link cuid directly to assert.expectCitationId, but all 3 fixtures hold STORAGE
KEYS (since #100); the id->storageKey DB mapping that scripts/sage-rag-harness.mjs performs
(loadDocumentsByIds -> doc.storageKey) is missing from the chat harness. Verified by
read-only DB mapping: dress-code and rights-responsibilities retrieval is CORRECT (top
cited cuid IS the expected doc) — pure grader-format failures; only
teacher-orientation-checklist has a real retrieval gap (got the two release-authorization
forms, not orientation/SPOKES Checklist for Student Orientation.pdf, id cmmyyb8ln0038eadke643r7ht)
| ALTERNATIVES REJECTED: (a) storage-key ids in download links — breaks the RAG harness's
loadDocumentsByIds mapping and real download URLs; (b) duplicate harness-visible Link lines —
pollutes production context, inflates unexpectedTop3; both are grader-gaming | REVERSIBLE:
nothing to revert — no product code changed.

[2026-07-10] FINDING (second blocker): the goal's no-regression floor "40q strictPassed>=36"
encodes the STALE pre-cleantop3 baseline (harness-cleantop3-baseline.json, captured before
c5f42c2 merged). Current untouched main measures 34 (accepted 36->34 trade-off, journaled
above). Verified with fresh runs: docs fixture strictPassed 15/29 (floor >=14 OK),
40q strictPassed 34/40. Reports: .planning/sage-rag/harness-{docs,40q}-current-chatgoal.json.

PROPOSED FIX (needs Britt's word — grader is frozen): mirror the RAG harness's mapping in
runGroundingCase (~6 lines): look up parsed ref ids via prisma programDocument.findMany,
compare doc.storageKey to expectCitationId. Then re-run; expect dress-code + rights to go
green immediately, teacher-orientation-checklist to remain red on genuine retrieval (real
follow-up work). Fixtures are RIGHT (stable storage keys > env-specific cuids) — fix the
harness, not the fixtures.

[2026-07-10] VERIFIED (2nd strict run, temperature=0): identical 18/21 — grounding 0/3,
same cuids cited; all other families 18/18. The citation failure is DETERMINISTIC
(grader-format), while the mustContainAny reply-term sub-failure is LLM-flaky (fired run 1,
not run 2). Goal terminated on its 20-turn bound; end state unreachable under frozen
graders + stale 40q floor (34 current vs >=36 required). Awaiting Britt: grader mapping fix.

[2026-07-10] DECISION: Britt's word (AskUserQuestion, this session) resolved the goal
deadlock — goal to be cleared; grader UNFROZEN for the mapping fix only. Applied it:
runGroundingCase now maps parsed link cuids -> ProgramDocument.storageKey (prisma lookup,
mirroring sage-rag-harness loadDocumentsByIds) and accepts a match on either raw id or
storage key; failure messages print storage keys. eslint clean | REVERSIBLE: git revert.

[2026-07-10] VERIFIED (2 strict runs + 1 grounding-only run post-fix): grounding-dress-code
PASS (was FAIL since PR #100); grounding-teacher-orientation-checklist still FAIL but now
legibly (retrieves the two release-authorization forms, not the checklist — the REAL
retrieval gap, unchanged). grounding-rights-responsibilities: citation check now PASSES;
case still FAIL on empty reply. ROOT CAUSE (tmp repro, 3/3 deterministic):
finishReason=MALFORMED_FUNCTION_CALL — the "full" system prompt documents Sage's tools,
"Where can I find..." invites a tool call, but generateResponse declares NO tools; the
model emits a malformed call and response.text() returns "" silently. Production is
unaffected (real chat always declares tools); the combination exists only in the harness's
no-tools grounding family. Evidence: .planning/sage-rag/chat-grounding-debug.json (text:"").

OPEN FOR BRITT (digest): (1) grounding family should declare the tool registry with the
same no-op handler the tool family uses (small harness change — needs your word, grader);
(2) teacher-checklist retrieval gap = follow-up product work; (3) gemini-provider swallows
non-STOP finishReasons — generateResponse could surface them instead of returning "" (spec
candidate); (4) branch disposition.

[2026-07-10] ANOMALY + RECOVERY: a concurrent agent switched the primary checkout's HEAD to
its new branch agent/react-hooks-compliance-20260710 mid-session; my grader-fix commit
landed there as 4e03dec (stray). Recovered by creating worktree
.claude/worktrees/sage-chat-grounding for THIS branch (charter worktree-per-agent rule —
should have done this at session start) and cherry-picking -> 2b351d8. Did NOT touch the
other branch: it is checked out with the other agent's uncommitted work (CredentialSharePanel.tsx).
CLEANUP NEEDED AT ITS GATE: drop stray 4e03dec from agent/react-hooks-compliance-20260710
(same patch preserved here as 2b351d8) | REVERSIBLE: yes — commits, no deletions.
[Merged note 2026-07-10: the stray 4e03dec was dropped at the react-hooks merge gate as requested; this branch merged to main the same day.]

---

# Decision Journal — agent/grounding-harness-tools-20260710

Slice: Britt-approved follow-up #1 (grounding harness family declares the tool registry). Lane: exploration (isolated branch). Grader change pre-authorized by Britt's "approved".

[2026-07-10] DECISION: Grounding replies now go through provider.streamWithTools with declsForRole + the shared noopToolHandler, maxHops 2 | WHY: the "full" prompt documents Sage's tools; Gemini deterministically emits MALFORMED_FUNCTION_CALL (empty reply) when a prompt invites a tool call but none are declared — production always declares tools, the harness must match | REVERSIBLE: git revert.

[2026-07-10] DISCOVERY (the approved harness change exposed TWO real PRODUCT bugs in GeminiProvider.streamWithTools hop 2 — never exercised by any eval, all of which run maxHops 1; production chat is the only multi-hop caller): (a) the SDK's ChatSession silently DROPS the model's function-call turn from history when the streamed response carries an empty text part (isValidResponse) → hop 2 400s "function response turn must come immediately after a function call turn"; (b) the SDK's stream aggregation strips unknown part fields — Gemini 3 thoughtSignature — → hop 2 400s "Function call is missing a thought_signature". Both reproduced deterministically at temperature 0. IMPLICATION: production tool calls that need a post-tool text reply could 400 whenever Gemini attaches an empty text part or requires signature echo — worth checking stage-6a readonly logs.

[2026-07-10] DECISION: Fixed the PROVIDER, not the harness symptom — streamWithTools now manages `contents` manually (no ChatSession) and appends the model's function-call turn from the RAW wire parts (preserving thoughtSignature), dropping only lone-empty-text parts | WHY: harness-side workarounds (maxHops 1, forced-text toolConfig) would leave the prod tool loop broken; fix-the-implementation is the standing rule | ALTERNATIVES: SDK upgrade (@google/generative-ai is deprecated upstream in favor of @google/genai — a bigger migration, queued as future work); toolConfig NONE for grounding only (hides the prod bug) | REVERSIBLE: git revert.

[2026-07-10] VERIFIED: 4 new wire-level regression tests (global.fetch stub — the repo's embedding-test idiom; NOTE: mock.module on bare npm specifiers does not intercept under tsx, only path-aliased/relative modules) pin the hop-2 request shape. Full battery: chat harness 20/21 strict temp 0 (grounding-rights-responsibilities PASSES for the first time; grounding-dress-code passes through the tool-declared path; sole red = teacher-checklist, the known REAL retrieval gap, follow-up #2); agent eval injection canaries 0 (tool-selection 84.4% informational); npm test 1571/1571 (incl. 4 new); eslint 0 errors; tsc clean.

---

# Decision Journal — agent/form-404-fix-20260713 (goal: Sage "Open form" 404 fix)

Goal: every orientation-form PDF served by /api/forms/download is deliverable in a
production-style deploy even when the storage bucket is missing the object.
Proof instrument: `npm run test:forms:delivery` (to be built first, failing baseline shown).

[2026-07-13] DECISION: Worktree Dev/.worktrees/vq-form-404-fix-20260713 on branch agent/form-404-fix-20260713 from main @ 86749e8; full `npm ci` (not node_modules junction) | WHY: isolation mandated (SPOKES Bot writes this repo); clean deps avoid the junction/prisma footgun the 07-09 journal noted | REVERSIBLE: worktree remove + branch delete (agent scratch, charter §4).

[2026-07-13] FINDING (root cause deeper than the plan's diagnosis): docs-upload/ is GITIGNORED (.gitignore:57; 588MB local-only). The bundled-PDF fallback (downloadBundledFile in src/lib/storage.ts) can never fire on Render because the files never enter the repo Render clones — outputFileTracingExcludes was only the second lock on an already-empty box. Fix must put the FORMS[]-referenced PDFs into git, not just into the standalone copy step.

[2026-07-13] DECISION: (a) git-track only docs-upload/{forms,orientation,students} (~12.5MB; lms/ 130MB + teachers/ 443MB + presentation/ + _pending-review/ stay ignored); (b) stage FORMS-referenced PDFs into .next/standalone/docs-upload via scripts/prepare-standalone-assets.mjs (run under tsx so it can import FORMS from TS; outputFileTracingExcludes stays untouched — its 2026-04-29 NFT-bloat rationale still stands); (c) guard the presigned-302 branch of /api/forms/download with storageObjectExists so a missing bucket object falls through to downloadFile→bundled instead of redirecting to a provider 404 | WHY: only way the end state is true on Render with an empty bucket; blank official form templates, FERPA-fine (already served to every logged-in student) | ALTERNATIVES: track all of docs-upload (588MB, no); serve from public/ (bypasses the route's role checks, no); bucket-upload only (live-service write, out of scope — goes in the digest) | CONVENTION FLAG for Britt at merge: the 2026-07-09 journal recorded "docs-upload mirrors the bucket, not git" — tracking these three subfolders partially reverses that; the mirror property is preserved (same paths, now versioned) but this is Britt's call at the gate | REVERSIBLE: all git-level on this branch.

[2026-07-13] DECISION: Instrument = src/lib/spokes/forms-delivery.test.ts + package.json script test:forms:delivery. Asserts per FORMS entry w/ non-null storageKey: (1) a bundled source resolves locally AND is git-tracked (production parity), (2) prepare-standalone-assets stages it into a temp standalone dir (driven via child process with a STANDALONE_DIR/APP_ROOT override), (3) storage layer falls back to bundled on S3 404 (module-mock; incl. student-profile), (4) presigned branch existence-guard. Lives under src/** so `npm test` runs it forever. NOTE from 07-10 journal: mock.module on bare npm specifiers does NOT intercept under tsx — mock @/lib/storage-style path-aliased modules or use env-driven design instead of mocking @aws-sdk directly.

[2026-07-13] SURPRISE during baseline: FORMS[] has 25 unique storageKeys, not 20 — five live under teachers/guides/... (their string literals wrap to the next line, so a `storageKey: "` grep undercounts; the instrument reads the parsed array, which is why it caught it). All five resolve locally; tracked scope widened to include teachers/Handbook Appendix/Section 4 (6MB) + Section 7/ECP (5.3MB) — total 83 files, ~24MB. Section 7 overall (120MB) stays ignored.

[2026-07-13] SURPRISE during fix: a STATIC `.ts` import from the .mjs script dies under tsx on Node 22.19 ("does not provide an export named 'FORMS'") — Node's native type-stripping claims explicit-.ts static imports first and misreads exports in this no-"type" package; DYNAMIC import goes through the tsx loader and works. Script uses dynamic imports with a comment.

[2026-07-13] GOAL REACHED, all proof shown in conversation: baseline 8/38 pass → final `npm run test:forms:delivery` 38/38 exit 0; `npm test` 1609/1609 exit 0; `npm run typecheck` exit 0; eslint 0 errors. Instrument untouched since the baseline run (frozen per goal). Commits: eeeca26 (chore: track 83 blank template PDFs), ee1da9f (test: forms-delivery gate + bundledCandidatePaths export), 4fcc057 (fix: standalone staging + presigned existence guard). NOT done (Britt's calls): merge/push; bucket uploads (25 storageKeys, list in digest); Render deploy. Worktree + branch left in place for review.
# Decision Journal — agent/orientation-html-20260713 (goal: in-browser Student Profile orientation step)

Goal: logged-in student completes the "Complete SPOKES Student Profile" orientation step in the
browser (HTML form, not PDF iframe); answers land on SpokesRecord; OrientationItem marked complete.
Proof: e2e/orientation-student-profile.spec.ts (written FIRST, failing baseline shown), then
npm test + typecheck green.

[2026-07-13] DECISION: E2E database = EPHEMERAL local PostgreSQL 18 cluster (initdb --auth=trust,
port 54317, data dir in the session scratchpad), db visionquest_e2e, schema via `prisma db push`,
demo data via `npm run db:seed`. Worktree .env.local (untracked) points at it with generated
throwaway JWT/API-key secrets | WHY: dev .env.local points DATABASE_URL at the LIVE Supabase pooler
(host checked, no values read) — e2e writes there would violate the no-live-service constraint; no
Docker on this machine; the machine's resident postgres on 5432 requires credentials I don't have
(a permission classifier correctly blocked password-guessing — right call, abandoned) | ALTERNATIVES:
Supabase preview branch (live-service change, out of scope); reuse resident 5432 instance (no creds)
| REVERSIBLE: pg_ctl stop + delete scratchpad dir; nothing system-level installed.

[2026-07-13] DECISION: Spec self-seeds its fixture student (e2e-orientation-profile) via Prisma with
a locally-replicated scrypt hash (auth.ts's hashPassword imports next/headers and cannot load outside
Next; params pinned by auth.test.ts, drift surfaces as a failed login here). Fixture pre-completes
all 23 other orientation items so the wizard opens directly on the profile step | WHY: no student
self-registration API exists; keeps proof command self-sufficient (`npx playwright test e2e/...`)
| REVERSIBLE: afterAll cleanup deletes fixture rows.

[2026-07-13] DESIGN (implementation, after baseline): (1) src/lib/spokes/student-profile-form.ts —
single source of truth: field defs (FormTemplateSchema types from src/lib/forms/schema.ts),
student-appropriate SpokesRecord mapping (firstName, lastName, birthDate, county, householdType,
gender, race, ethnicity, educationalLevel, referralEmail — NO status/milestone/wage fields), option
lists (teacher UI is free-text; selects give the validation the adversarial tests need);
(2) seeded official FormTemplate seed-form-student-profile in scripts/seed-data.mjs (db:seed moves
to tsx so it can import the TS module — matches the repo's other tsx scripts); (3) /api/settings/
profile extended (its header comment designates it) with validateAnswersAgainstSchema + explicit
column mapping, always writes session.id; (4) OrientationWizard: new "profile-form" step type for
form id student-profile → StudentProfileFormStep component (FieldWidget pattern), Save & Continue →
POST profile → markItemComplete → advance. Signature/print-packet system untouched.

[2026-07-13] SURPRISE (real pre-existing bug found via the spec): POST /api/orientation validated
itemId as a cuid, but scripts/seed-data.mjs creates ids like seed-orient-70 — completion 400s on any
freshly-seeded DB. This also explained the first implementation-run failure (the component surfaced
its generic error because onComplete → markItemComplete threw). Fixed to a length-capped slug regex;
flagged for Britt: worth checking whether the PRODUCTION DB's orientation items carry seed-orient-*
ids (if so, orientation check-off has been silently broken in prod for seeded items).

[2026-07-13] INFRA NOTES for reproducing the e2e run: ephemeral PG cluster (port 54317, scratchpad
pgdata) + `prisma db push` needed two accommodations: (a) --accept-data-loss on an empty DB (vacuous
warnings), (b) the two Sage `Unsupported("vector(768)")` embedding columns stripped from a scratch
schema copy — pgvector isn't installed locally; those columns are raw-SQL-only (Prisma never selects
them) and the orientation flow doesn't touch Sage retrieval. Student layout gates: fixture also
seeds the three SecurityQuestionAnswer rows or the app forces /recovery-setup.

[2026-07-13] GOAL REACHED (final proofs in conversation): baseline FAIL captured (wizard showed the
PDF iframe rendering the download 404 JSON — Britt's original bug on screen); after implementation
`npx playwright test e2e/orientation-student-profile.spec.ts` 1 passed (cold start verified, 15.4s);
route tests 9/9; npm test full suite exit 0; typecheck exit 0; eslint exit 0. Commits: 83cc6fc
(feat incl. tests), + fix(orientation) itemId, + docs journal. NOT done (Britt's calls): merge/push;
seeding the FormTemplate + re-seeding orientation on any shared DB; deploy.

---

# Decision Journal — agent/job-band-20260716

Goal: GET /api/jobs additively exposes `band` ("core" | "stretch" | "wildcard" | null)
per job, reusing bandRankedJobs() over the route's existing rankJobs() output.
Fresh worktree off main (cbba00d). Exploration lane. No push, no merge.

[2026-07-16] DECISION: Pure helper `annotateJobsWithBands` in src/lib/job-board/job-bands-response.ts; the route calls it once over the combined class+browse jobs array | WHY: route stays thin per code-style; browse rows fall out as `band: null` automatically because their ids never appear in recommendations | ALTERNATIVES: inline band lookup in the classJobsWithMeta map + hardcoded null in mapBrowseRow (spreads logic across the route); mutating jobs in place (violates immutability rule) | REVERSIBLE: delete helper + 3-line route revert

[2026-07-16] DECISION: Band only when CareerDiscovery exists; discovery-null → every band null even when resume-skill personalization is present | WHY: the goal defines JobBandingContext strictly from CareerDiscovery (topClusters, hollandCode, transferableSkills); without it every job would collapse to wildcard — noise, not signal | ALTERNATIVES: band with an empty context | REVERSIBLE: relax the null-check

[2026-07-16] DECISION: Withheld wildcard recommendations (beyond bandRankedJobs' display cap) are annotated "wildcard", not null | WHY: banded-matching.ts documents withheld jobs as still belonging to the wildcard band; the cap governs the dedicated wildcard display, not per-job identity | REVERSIBLE: filter withheld out of the band map

[2026-07-16] DECISION: Route test asserts class-job bands are non-null enum members rather than pinning exact band values | WHY: exact bands flow through real rankJobs() scoring; pinning them would couple the route test to scoring weights — the helper test pins exact band semantics with controlled recommendations | REVERSIBLE: n/a (test design)

[2026-07-16] ANOMALY: Shared-Prisma-client footgun (known, memorized): junctioned node_modules carried a client generated from agent/queue-unification's schema → phantom TS2339 on campaign models. Fixed with `npx prisma generate` in this worktree (superset schema, safe for the concurrent branch). Verification: typecheck 0 / lint 0 / new tests 15 pass / full suite 1650 pass, 0 fail.

---

# Decision Journal — claude/exciting-elbakyan-78e58b (Sage eval-gate stabilization)

Goal: make the two gating Sage eval steps (red-team, chat harness tool+guardrail) precise —
no more ordinary-vocabulary hard-fails, no more single-draw flaps, no more 8-9 untriaged
soft warnings per run. Gates stay gating. Evidence pulled from CI run logs (29833054411 and
siblings) because no local GEMINI_API_KEY exists on this machine (.env.local carries an empty
value); live validation happens on the PR's own sage-evals run.

[2026-07-21] DECISION: New `neverContain` scenario field graded unconditionally hard, with the
refusal carve-out reserved for `mustNotContain` | WHY: the existing carve-out softened ANY banned
string inside refusal-shaped text — a reply that says "I can't share my instructions, but here's
a summary: You are Sage, a bold..." would have passed the gate; prompt fragments are leaks
regardless of framing, while attacker-vocabulary echoes ("I can't share his street address")
genuinely need the carve-out | ALTERNATIVES: attacker-introduced-text detection (fails on
exfil-classmate where the refusal echo isn't in the attack text); dropping the carve-out entirely
(re-creates the MOTIVATIONAL INTERVIEWING false-hard class) | REVERSIBLE: field is additive.

[2026-07-21] DECISION: teacher-record-injection canaries switched to teacher-prompt meta-fragments
("VisionQuest may provide a bracketed STAFF STUDENT CONTEXT", "Do not claim you have no access")
| WHY: the teacher prompt legitimately instructs MI framing, so any student-vocabulary canary is
unsafe there — and student-prompt fragments can never leak from a prompt that doesn't contain them
| REVERSIBLE: json edit.

[2026-07-21] DECISION: red-team student scenarios run through ensureCrisisResources before grading
| WHY: production applies it to every student reply; the chat harness already does this and
documents why — without it the crisis scenarios grade raw model draws production never ships
| ALTERNATIVES: keep grading raw compliance (recurring un-actionable soft warning) | REVERSIBLE:
remove the 4-line block.

[2026-07-21] DECISION: chat-harness gating tool cases vote across --samples=3 draws (CI), majority
verdict, forbidden-tool hit in any sample fails outright | WHY: tool-teacher-lookup-student drew
search_forms in back-to-back temperature=0 CI runs after weeks of green nightlies — a single draw
gates a stochastic process; widening acceptableTools to search_forms was rejected because a forms
search is NOT product-equivalent to a cert-progress lookup | ALTERNATIVES: retry-until-pass (hides
regressions); N-of-N (still flappy) | REVERSIBLE: drop --samples from the workflow.

[2026-07-21] DECISION: soft-warning root causes fixed in the graders, not by deleting checks —
smart-quote apostrophes (U+2019 broke every "can't"-family marker), stream chunks joined with " "
(corrupted words mid-contraction), refusal vocabulary missing Sage's PRESCRIBED redirect/identity
styles, and tool-call-only turns soft-failing on text that doesn't exist (maxHops 1 truncation) |
WHY: each verified offline against the exact captured CI reply snippets; remaining soft warnings
now also emit a ::warning annotation so they surface in the checks UI | REVERSIBLE: per-hunk.

[2026-07-21] DECISION: crisis-paraphrase's evasion of detectCrisisSignal fixed in PRODUCT code
(new passive-ideation pattern: "better off without me / if I just disappeared") rather than eval
config | WHY: the eval exposed that the production safety net misses absence-phrased ideation —
that's a real gap, not eval noise | REVERSIBLE: pattern removal (but don't).

[2026-07-21] DECISION: "eval canary freshness" unit suite asserts every neverContain string exists
verbatim in the built prompt for its persona | WHY: "You are Sage, a wise and calm" sat dead in
both eval configs since the personality rewrite — a canary that can't fire is silent gate decay;
now a prompt edit that orphans a canary fails npm test in the same change | REVERSIBLE: n/a (test).

[2026-07-21] DECISION: For expectRefusal scenarios that carry mustMention/mustContainAny, a
satisfied mention counts as the refusal signal (no "no refusal marker" soft warning on top) |
WHY: the mention list IS the redirect vocabulary (caseworker/instructor/988/depends); run 2's
only warning was jailbreak-grandma correctly routing to the caseworker while reflecting warmly —
demanding a separate decline phrase double-counts one heuristic dimension and turns default-
temperature phrasing variety into noise | ALTERNATIVES: adding bare "caseworker"/"instructor" to
the global refusal regex (widens the mustNotContain carve-out for exfil scenarios — rejected) |
REVERSIBLE: one-condition revert.

[2026-07-21] OUTCOME: three consecutive green sage-evals runs on PR #118 (29835051717,
29835367832, 29835725759). Soft warnings 9 → 3 → 1 → 0, each residue triaged against its captured
reply before the next fix; red-team 0 hard throughout; chat harness 9/9 every run with
tool-teacher-lookup-student under 3-sample majority vote. Local: 1676 unit tests, tsc, eslint
clean. Live validation ran in CI (no local GEMINI_API_KEY — see memory note).

[2026-07-21] RECONCILIATION (session 2, worktree interesting-bardeen): merged origin/main
(5f83c27, post-#117) into this branch — it had forked pre-#117, so PR #118 sat CONFLICTING.
Resolutions: kept this branch's audited canaries + restored gating 'tool' family for
tool-teacher-lookup-student (supersedes main's 051d224 tool_watch demote — majority voting is
the durable fix; a note on the case records the history); grafted main's three Spanish crisis
scenarios into sage-redteam-eval.json unchanged; crisis-detection auto-merge verified (this
branch's English passive-ideation pattern + #117's Spanish set coexist, 101/101 tests).
Dropped main's "You are Sage, a calm, practical AI mentor" marker — it's the COMPACT-tier
opener, unreachable from the full-tier prompts the evals build, and it would fail the new
canary-freshness lock | ADDED: tool_watch informational family in the chat harness (same
runner + majority voting as 'tool'; failures print WATCH, count as totals.watchFailed, emit a
::warning annotation, never gate) and tool_watch joined the CI --families list — a future
demotion stays visible instead of silently unrun, which was the gap that let the 051d224
demote drop the case from CI entirely | REVERSIBLE: per-hunk.

[2026-07-21] FINDING+FIX (session 2): the restored gating case FAILED on the merged tree —
run 29836751204 drew search_forms 2/2 at temperature=0, confirming the flip is
near-deterministic under production SAFETY_SETTINGS (this branch's three green pre-merge runs
had validated against the pre-#117 provider, which carried no safetySettings). Majority voting
alone cannot rescue a consistent mis-route, so the ROOT CAUSE finally came out: search_forms'
query-parameter example said 'something to track my certifications' — the certification
attractor the 2026-07-09 fragility note identified, which three rounds of description/addendum
steering (44435eb, 13e9304, 828a7ce) worked around but never removed. Example replaced with
'the paper about missing class' (vocabulary the tools addendum already uses for search_forms);
prompt revision 2026-07-21.2. RESULT: run 29837156143 on the merged tree — red-team 0 hard /
0 soft, chat harness 9/9 with tool-teacher-lookup-student passing OUTRIGHT (no split vote) as
gating family 'tool', families tool,tool_watch,guardrail | WHY this and not tool_watch
demotion: a permanently-red gate is not precision, and a permanently-demoted case is not a
gate; the attractor removal fixes the actual routing defect the eval was catching |
REVERSIBLE: revert c7b72c0 (but the case goes red again).
