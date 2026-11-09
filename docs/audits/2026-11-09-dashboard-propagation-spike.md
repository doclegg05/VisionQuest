# Dashboard propagation spike (W5)

Date: 2026-11-09. Branch: `docs/consolidated-remaining-work`.
Plan reference: `docs/plans/2026-11-09-consolidated-remaining-work.md`, section W5. Original proposal: `docs/plans/2026-09-10-dashboard-data-and-live-updates.md` (retired into W3 and W5).

This is a paper spike. It reads the code, compares three transports and recommends one first slice. No code was changed and no database, Render or Supabase setting was inspected. The recommendation is a proposal for Britt to accept or change.

## Current state

### Notifications use process-memory SSE

- Live connections sit in a module-level `Map` of user id to writers (`src/lib/notifications.ts:12`). Limits are 5 per user and 500 total (`:15-16`).
- `sendNotification` writes a `Notification` row, then pushes to whatever writers this process holds (`:148-181`). A writer held by another process is never reached.
- The stream endpoint adds the writer to that map (`src/app/api/notifications/stream/route.ts:53`) and sends a heartbeat every 30 seconds (`:68-70`).
- Reconnect replay exists: `?lastId=` replays up to 20 later notifications (`stream/route.ts:6`, `:16-18`, `:88-130`). The client never sends it. `NotificationProvider` opens `new EventSource("/api/notifications/stream")` with no cursor (`src/components/ui/NotificationProvider.tsx:53`) and ignores errors (`:67-69`).
- The payload is a notification (title and body). It does not carry or announce a record change. Nothing on a dashboard subscribes to it for data.

Plain statement: **process-memory SSE is lost on restart and is per-instance.** A deploy or crash drops every connection and every in-flight push, and a notification created on one instance is not pushed to a browser connected to another. `render.yaml` declares one web service on the `starter` plan (`render.yaml:2-5`) and has no instance-count or scaling key, so Render's default of one instance applies. That is why the per-instance limit has not shown up. It would show up the day a second instance runs. `src/lib/db.ts:20-21` already documents a multi-instance pool plan, so the intent exists.

### Dashboards refresh by polling and by reloading

| Surface | Mechanism | Evidence |
| --- | --- | --- |
| Student dashboard data regions (overview, activity, support, tasks) | TanStack Query with `staleTime` 30 s, `refetchInterval` 30 s, refetch on window focus and on reconnect, no background polling | `src/lib/dashboard/query.ts:6`; applied at `src/app/(student)/dashboard/DashboardClient.tsx:36`, queries at `:55-60` |
| Student dashboard after a write | `invalidateQueries` on the dashboard key when a mutation settles | `DashboardClient.tsx:71` |
| Dashboard API responses | `Cache-Control: private, no-store` | `src/app/api/dashboard/overview/route.ts:8` |
| Staff intervention queue | One fetch on mount or class change. No interval, no focus refetch. | `src/components/teacher/InterventionQueuePanel.tsx:436-466` |
| Staff and coordinator shells | Mount `NotificationProvider` only | `src/app/(teacher)/layout.tsx:5`, `:23`; `src/app/(student)/layout.tsx:10`, `:64` |
| Single-purpose refreshes | `router.refresh()` after specific actions, for example `FormFillClient.tsx:135`, `StudentAdvisingHub.tsx:119`, `:149`, `OpportunitiesHub.tsx:78` | grep over `src/` |
| Server cache | `revalidatePath` and `revalidateTag` are not used anywhere in `src/`. Sage context uses a process-local cache with write-through invalidation. | grep over `src/`; `src/lib/chat-context-write-through.ts`, `src/lib/cache.ts:1` |
| Version counters | No per-student revision exists. `Progression.version` is a progression-state lock (`prisma/schema.prisma:277-284`, `src/lib/progression/events.ts:95`), not a change counter for records. | grep for `StudentDataRevision` returns nothing |

So today a second open view learns about a write in up to 30 seconds on the student dashboard, and only on a manual reload on the staff queue. The student side already refetches whole snapshots on a timer, which is correct when it is slow. It fetches four regions every 30 seconds per open tab whether or not anything changed.

## Requirements (from W5, copied as a checklist)

- [ ] Reuse the agreed records and selectors from W3. No second student database.
- [ ] Prove a scoped revision and transport spike before choosing common SSE, polling or another mechanism. Do not prescribe infrastructure before the contract is proven.
- [ ] Two authorized sessions converge after duplicate, reordered or lost updates, and after reconnect.
- [ ] A refresh recovers missed state.
- [ ] Scope and role changes cannot deliver another class's or another student's records.
- [ ] Saving works when streaming is disabled.
- [ ] The UI distinguishes saved, pending and failed extraction or review.
- [ ] The transport can be disabled independently. Persisted writes and manual refresh keep working.
- [ ] (From the original proposal, as a target to test, not a claim) An already-open authorized second view reflects a write within 5 seconds at the 95th percentile under pilot load.

## Options compared

| | 1. Poll a per-student revision | 2. SSE as a hint, persisted revision as truth | 3. Postgres LISTEN/NOTIFY or Supabase Realtime |
| --- | --- | --- | --- |
| What it needs | A revision per student, bumped in the same transaction as each domain write. A small GET that returns the revision for the caller's scope. Client compares and refetches only on change. | Everything in option 1, plus a stream that pushes "revision changed" to the open tabs. The existing SSE plumbing can carry it. | A durable connection from each app process to Postgres (LISTEN needs a session-level connection, not a transaction pooler; `prisma/schema.prisma:8` has a `directUrl`, which suggests one exists). Or Supabase Realtime private channels, which need a token and channel-authorization bridge to the app's own cookie session. |
| Lost updates | Cannot lose one. The next poll sees the larger number and refetches. | A lost push is covered by the revision poll fallback, or by a revision handshake on reconnect. | NOTIFY is not stored. A listener that is down misses it. Needs a revision table or replay anyway. |
| Duplicate updates | Harmless. Same revision means no refetch. | Harmless if the client ignores a revision it already has. | Possible on reconnect. Same fix. |
| Reordered updates | Cannot matter. The client keeps the highest revision seen and refetches the snapshot. | Same rule: compare numbers, never apply the pushed payload. | Same rule needed. Payload ordering is not guaranteed across channels. |
| Reconnect | Nothing to reconnect. Each poll is independent. | `EventSource` reconnects on its own. Client must refetch the revision on `open`. | Listener reconnect logic in the server, plus client reconnect for Realtime. |
| Scope and role safety under RLS | One read through the app client under the caller's RLS context returns only rows the caller may see. A staff poll takes a list of managed student ids from the server, never from the request. No payload leaves the server except a number. | Stream authorization must be rechecked while the connection lives (logout, reassignment, deactivation). The in-memory map has no such recheck today (`notifications.ts:72-113`). Payload is a number only. | NOTIFY runs on a server connection, so the server must fan out per authorized user itself. Realtime private channels need their own policies keyed to something other than the app's `x-vq-*` headers. Highest risk of a cross-student leak. |
| Cost on Render | One tiny indexed read per open tab per interval. Two round trips under RLS injection (a known cost, see `.claude/MEMORY.md` Known Issues). At 5 s with 30 open tabs that is 6 requests per second, small against the pool in `src/lib/db.ts:17-21`. | Fewer polls (slow fallback at 30 s) plus held connections. A held connection per tab, bounded at 500 by `notifications.ts:16`. | Adds a permanent database connection per app instance, or a Realtime add-on with its own connection and message quotas. Both are cost and operations the pilot has no evidence it needs. |
| Failure mode when disabled | Fall back to the current 30 s `refetchInterval` and focus refetch (`query.ts:6`). Saves and reloads are untouched. | Stream off means only the poll runs. Same as option 1. | Off means no live updates until the fallback poll exists, which means option 1 anyway. |
| Works with more than one instance | Yes. State lives in Postgres. | Only if the push is also driven from the database. A push from process memory still misses other instances. | Yes, if every instance listens. |
| Changes outside the happy path | Needs every writer to bump the revision. About 45 write call sites exist across 8 models (inventory: `docs/audits/2026-11-09-record-truth-inventory.md`). | Same. | Same, unless a database trigger does it. |

The revision is the part the options share. The transport differs only in how fast the browser hears that the number changed.

## Recommendation (proposal for Britt)

Choose option 1: **poll a persisted per-student revision.** Keep option 2 as a later accelerator that uses the same number. Do not start with option 3.

Reasons:

- It meets every W5 acceptance line without a held connection: lost, duplicate and reordered updates collapse into "the number is higher, refetch". Disabling it leaves the 30 s refetch that already exists.
- It is the only option whose correctness does not depend on how many Render instances are running or whether one restarts.
- It keeps the RLS story simple. The server decides which student ids a staff poll may ask about, and the response is a number, not a record.
- The 5 second target is reachable at a 5 to 10 second interval. The current 30 second interval is not.

### Smallest first slice

One record type, one dashboard, one direction.

- Record type: a certification requirement (`CertRequirement`), the "awaiting instructor review" to "verified" change. The student's current count is `src/lib/dashboard/readers.ts:34-37`. The staff writer is `src/app/api/teacher/certifications/route.ts:210`.
- Dashboard: the student dashboard Overview region (`/api/dashboard/overview`), which already polls (`DashboardClient.tsx:55`).
- Direction: staff verifies, an already-open student tab updates.

Work, in order:

1. Add a revision store: one row per student with a number that only increases (`StudentDataRevision`, additive migration, RLS policy that lets a student read their own row and staff read their managed students' rows). This is a proposal for shape only.
2. In the staff verify handler (`teacher/certifications/route.ts:210`), bump the student's revision in the same transaction as the requirement update. Do not publish from a callback that can fire before commit.
3. Add a small authenticated GET that returns `{ revision }` for the session student.
4. In the dashboard client, poll that endpoint every 5 seconds while the tab is visible. When the number is higher than the last seen, invalidate the Overview query. Keep the existing 30 second refetch as the fallback.
5. Add a visible "updated" time to the Overview region, which `RegionStatus` already renders (`DashboardClient.tsx:40`, `fetchedAt`).
6. Put the poller behind its own flag so it can be turned off without touching saves.

The inventory's mismatch 2 (three definitions of "awaiting verification") should be settled first for this record type, otherwise the slice proves propagation of a number staff and students define differently.

### Acceptance test

A Playwright test with two browser contexts and fictional users (one student, one assigned instructor), run against a hermetic Postgres:

1. Student context opens the dashboard and records the Overview "awaiting review" figure.
2. The student marks a requirement complete (existing route, `certifications/route.ts:224`). Overview shows one awaiting review.
3. Instructor context verifies it through the staff route.
4. Assert the student's open tab shows the verified state within 5 seconds, measured from the verify response, with no reload.
5. Repeat the verify call with the same body (duplicate) and send two verify calls concurrently (reorder). The student view settles on the same final state and the revision never decreases.
6. Block the poll endpoint in the student context. Assert the 30 second fallback still converges and the save itself succeeded.
7. Reassign the student to a different instructor's class and call the poll endpoint as the first instructor's session. Assert it returns 403 or an empty scope, not the student's revision.
8. Roll back a write (force a failure after the bump inside the transaction). Assert the revision did not change.

Record the p95 latency over at least 20 runs. The 5 second target is a number to measure, not a number to assume.

## What this spike did not check

- Whether production Render runs more than one instance. `render.yaml` does not say, and the dashboard setting was not inspected.
- Whether the Supabase pooler mode allows LISTEN on `DATABASE_URL`. Only the presence of a `directUrl` was read.
- Real classroom concurrency. The request-rate figure above is arithmetic from a pilot-sized assumption, not a measurement.
