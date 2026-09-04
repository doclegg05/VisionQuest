# Loose-ends sprint: 2026-09-08 → 2026-09-11 (Tue–Fri)

**Status**: PLANNED. Owner-directed priority for the week of Sept 8.
**Why this exists**: on 2026-09-04 Britt found that several long-open items were not visible
anywhere they would be read. This document is the single place they live until they are closed.

Every claim below was verified against **production** on 2026-09-04, not carried over from
`.claude/MEMORY.md`. Several memory entries were stale and are corrected here.

---

## 1. Verified state, 2026-09-04

| Item | What memory said | What production actually shows |
|---|---|---|
| Background job backlog | 153 pending since 2026-05-14 | **0 pending.** Expired by operator 2026-09-03. 189 failed, 4 completed |
| Failed jobs | not tracked | 188 `send_email` (2026-03-23 → 03-31) + 1 `scrape_jobs`, all marked `expired by operator on 2026-09-03` |
| RAG corpus | "463 inactive ProgramDocuments" | **7 inactive, 523 active.** The real gap is embeddings, not activation |
| RAG embeddings | not tracked | **54 of 530 documents have an embedding. 76 `DocumentChunk` rows total** |
| pg_cron registration | 3 jobs, none working | **7 jobs registered, 6 of 7 healthy over 24h.** #187 (`c583189`) is merged |
| `app.base_url` GUC | never set | Appears set. 6 jobs succeed. See §2 for the one exception |
| Per-role model bake-off | never run | **Confirmed never run.** No `ai_provider_model_{role}` rows in prod, no committed run artifact |
| Local model eval coverage | never measured | **Confirmed.** No local model has been scored on tool selection, red-team, or grounding |

### What this means

Two of the items that prompted this sprint are **already closed** and should not consume the week:

- **The job queue is drained.** D4 was decided and executed on 2026-09-03. The 189 failed rows are
  deliberately expired March/May work, not a live backlog. No action beyond recording it.
- **The scheduled layer is repaired.** Bundle 0 / F1 is effectively done. Six of seven cron jobs ran
  clean over the last 24 hours, including `job-processor` at 144 runs.

Two items are **real, verified, and untouched**, and they are what the week is actually for:

- **The RAG corpus is 90% ungrounded.** 523 active program documents, 54 embeddings, 76 chunks.
  Sage answers program-content questions from roughly a tenth of the material it has been given.
- **No local model has ever been measured.** The per-role capability shipped 2026-08-21 with no
  model assigned to any role, and the picks still cannot be made because the bake-off has not run.

---

## 2. The one open verification from #187

`sage-memory-consolidate` is registered and active, but its most recent run message is still:

```
ERROR:  unrecognized configuration parameter "app.base_url"
```

It has not fired in the last 24 hours, which is expected for a weekly job. So this error is most
likely **stale**, left over from a run that predates the GUC being set, and the other six jobs
succeeding is good evidence the GUC is now present.

**Do not declare it fixed from that inference.** Confirm on its next weekly fire (§3, Friday).

---

## 3. The week

### Tuesday 2026-09-08 — RAG corpus embedding

The highest-value item, because it changes what Sage can actually answer.

1. `npm run sage:rag:triage:worksheet` and review the output. 523 active documents is more than the
   corpus was believed to hold, so the triage list should be re-derived, not reused.
2. Decide which documents belong in Sage's grounding set. Today only 67 carry `usedBySage`.
3. `npm run sage:rag:backfill` for the approved set. Idempotent.
4. Re-check coverage. Target: embedding count and `DocumentChunk` count both rise to match the
   approved set, not 54 and 76.
5. `npm run sage:rag:harness` to confirm retrieval quality did not regress on a larger corpus.

**Done when**: the approved documents all carry embeddings, chunk count reflects them, and the RAG
harness is green.

### Wednesday 2026-09-09 — the bake-off

Blocked since 2026-08-21 on one run against real hardware. See
`docs/plans/2026-08-21-local-ai-role-models.md` §7.

1. **Record the host first.** Chip, RAM, Ollama version, `OLLAMA_NUM_PARALLEL`, `OLLAMA_KEEP_ALIVE`.
   Every local-model number in this repo's history has an unrecorded host, which is why they
   contradict each other. This is not optional bookkeeping.
2. `npm run sage:model:bakeoff -- --models=<candidates> --json-out=reports/2026-09-09-bakeoff.json`
3. **Commit the artifact.** No local-model run artifact has ever been committed.

**Done when**: a committed JSON artifact scores every candidate against all four roles.

### Thursday 2026-09-10 — local model eval coverage

The single capability that most decides the `chat` role has never been measured on any local model.

1. `npm run sage:agent:eval -- --provider=ollama --model=<top chat candidate>` (tool selection)
2. `npm run sage:redteam:eval -- --provider=ollama --model=<same>` (boundary behavior)
3. `npm run sage:quality:eval -- --provider=ollama --model=<same>` (reading level, grounding)
4. Set the resulting `ai_provider_model_{chat,extract,document,draft}` SystemConfig rows.
   These are config rows, so no deploy is needed.

**Done when**: the four role rows exist in prod and each is backed by a scored run.

### Friday 2026-09-11 — verify, re-measure, close out

1. **Confirm `sage-memory-consolidate` fired clean** on its weekly schedule (§2). If the GUC error
   recurs, that is a live bug and takes the rest of the day.
2. `npm run cron:health` — expect exit 0.
3. **Re-run the load test for real.** The "15 students = 9.0 min p50" figure is a projection whose
   stated premise is wrong: `scripts/install-local-ai-services.ps1` sets `OLLAMA_NUM_PARALLEL=4`.
   `npm run sage:load:test -- --concurrency=15 --turns=1 --classroom-size=15`
4. Update `.claude/MEMORY.md` with what actually closed, and delete the stale entries this document
   corrects in §1.

**Done when**: memory reflects reality and no item in §1 is still described wrongly.

---

## 4. Explicitly NOT this week

- **Pooling the classroom machines for concurrency.** Discussed 2026-09-04. It is a real and
  well-scoped build (a health-checked pool behind `ai_provider_url`, plus LiteLLM and a tunnel or
  mesh VPN), but it is new work, not a loose end. It also depends on Wednesday's bake-off, since
  there is no point pooling machines before knowing which model they should each run.
- **The 189 failed job rows.** Deliberately expired. Leave them as the audit trail.
- **D7, D8, D1–D6.** Product calls, still owner-owned, unchanged by this sprint.

---

## 5. Standing hazards for whoever runs this

- The only Supabase project is **production**. There is no dev database. Anything destructive is
  destructive to live student data.
- A worktree does not inherit `node_modules`, `.env.local`, or a generated Prisma client. Run
  `npm ci` and `npx prisma generate` inside it, or the errors will point at files you never touched.
- Any local-model A/B must evict the previous model between arms, or the result inverts. Models do
  not co-reside and the loser dies at the 300s provider cap looking like a code failure.
