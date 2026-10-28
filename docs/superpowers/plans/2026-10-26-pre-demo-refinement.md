# Pre-Demo Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the remaining pre-demo findings on `codex/Supabasedesign`: vulnerable dependencies, four task-workflow defects, two intake defects, client-side CSP violations, and stale release notes.

**Architecture:** Dependency fixes go first, because they can change behavior under every other task. Task-editor fixes move the edit dialog out of the TanStack table, so a refresh can't unmount it. Conflict recovery reads the latest task through a new owner-scoped `GET /api/tasks/[id]`. Intake and due-date logic moves into small pure functions that unit tests can reach. Browser behavior is checked in the private developer preview, never against the shared database.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6, Zod 4 (`src/lib/zod-csp.ts` for browser-shared schemas), TanStack Query/Table, Radix Dialog, React Hook Form, `node:test` via `node --import tsx --test`, Playwright via `scripts/developer-preview-journeys.mjs`.

**Spec:** Findings from the 2026-10-26 Codex review and Claude review of this branch (no separate spec file). The verified finding list is the "Source findings" section below.

## Source findings (verified against code 2026-10-26)

| # | Finding | Evidence |
|---|---|---|
| F1 | `npm audit`: 34 vulnerable packages (3 critical, 23 high). Critical: `next@16.3.4` (two unauthenticated RCEs fixed after 16.4.0, next/og RCE <16.3.6), `@sentry/nextjs@10.70.0` (<10.75.2), `dompurify@3.4.14` via `jspdf` (≤3.4.16). npm offers no automatic fix | `npm audit --json`, 2026-10-26 |
| F2 | Teacher task due time fails validation: the `datetime-local` input sends `2026-10-27T09:30`, and `dueDate` accepts only `z.iso.date()` or zoned `z.iso.datetime()` | `OperationsTab.tsx:474`, `StudentDetail.tsx:325`, `task-schemas.ts:7` |
| F3 | The signature ownership query sits in the route, against "Prisma queries go in `src/lib/`" | `forms/sign/route.ts:64` |
| F4 | `TaskDialog` renders inside a table cell, so a refresh that drops the row unmounts the dialog and its draft | `TaskTable.tsx:22` |
| F5 | After a 409, Save resends the same stale `updatedAt` (`editingTask` is captured when the dialog opens). No single-task read exists to recover | `TaskDialog.tsx:19,30`, `DashboardClient.tsx:72` |
| F6 | Staff-assigned tasks show "Staff-managed" with no way to read `description` | `TaskTable.tsx:18,22` |
| F7 | Intake Step 1 accepts an invalid email | `IntakeClient.tsx` `validateStep1` |
| F8 | Checking "wish not to identify" overwrites race/ethnicity/language state, so unchecking it loses the earlier answers | `IntakeClient.tsx:616-618` |
| F9 | `/intake` and `/dashboard` still emit CSP `script-src`/eval violations. Probable cause: `src/lib/intake/schema.ts` imports plain `zod` (the JIT probe calls `new Function`), and the wrapper exists only for task schemas | `zod-csp.ts`, `intake/schema.ts:1` |
| F10 | Release notes conflict: the deepmerge item is marked unresolved, the audit result is stale, and local checks are mixed with deployment checks | `docs/dashboard-implementation.md:5` |

## Global Constraints

- The only Supabase project is production. Never run Playwright, `RLS_TEST_ENABLED`, or seed scripts against `.env.local`'s `DATABASE_URL`. All browser checks run in the developer preview (`npm run preview:local`).
- No student id in any `logger.*` payload. Use the staff `actorId`, or `studentLogKey(id)` (`src/lib/log-keys.ts`).
- Zod at every request boundary. Browser-reachable schemas import `z` from `@/lib/zod-csp`, never from `"zod"` (type-only imports are allowed).
- Tailwind only. No new CSS modules or inline styles. Interactive targets are at least 44×44px (`min-h-11`).
- Plain-language copy at about a 6th-grade reading level, with errors shown inline next to the field.
- Files stay under 800 lines, functions under 50 lines, and nothing new uses `any`.
- Commit subjects use `type: description`, with no attribution trailers. Run `npx eslint .` before each commit.
- Do not change API response envelopes; that is deferred by owner decision.

## Review Focus

- A teacher due date entered across a DST boundary, or with no time component, must keep the instant the teacher picked. Pinned in Task 2.
- A staff task with an empty `description` must still open a readable details view ("No extra instructions."). Pinned in Task 4.
- A task deleted in another tab while it is being edited must keep the draft and say the task is gone, not loop on 409. Pinned in Task 5.
- An intake applicant who leaves the optional email blank must still advance. Pinned in Task 6.
- Skip checked at submit time must send "Prefer not to say" for gender, race, ethnicity and language even if earlier answers exist. Pinned in Task 6.

---

### Task 1: Dependency remediation

**Files:**
- Modify: `package.json` (`dependencies`, `overrides`), `package-lock.json`
- Modify if the API changed: `src/lib/email.ts` (nodemailer 9 → 10)

**Interfaces:** Produces an upgraded tree. Every later task runs on it.

- [ ] **Step 1: Record the baseline.** Run `npm audit --json > $TMPDIR/audit-before.json`. Expected: `metadata.vulnerabilities` = `{"low":1,"moderate":7,"high":23,"critical":3,"total":34}`.
- [ ] **Step 2: Bump direct dependencies** to these versions, all confirmed published on 2026-10-26: `next` `^16.4.3` (plus `eslint-config-next` at the same version), `@sentry/nextjs` `^10.76.2` (stay on 10.x; 11.x is a major), `zod` `^4.6.7`, `nodemailer` `^10.2.1`.
- [ ] **Step 3: Update `overrides`.** Set `sharp` → `0.35.5`, `fast-uri` → `3.1.9`, and keep `postcss` `8.5.24`. Add `dompurify` → `3.4.17`, `brace-expansion` → `5.0.12` and `source-map-js` → `1.2.2`. Keep the `@prisma/config` → `deepmerge-ts` override.
- [ ] **Step 4: Run `npm install`.** Then run `npm ls sharp dompurify fast-uri brace-expansion source-map-js next zod`. Expected: every package resolves to the versions above.
- [ ] **Step 5: Check nodemailer 10** against its changelog for `createTransport` and `sendMail` changes. Apply any change to `src/lib/email.ts`. Run `node --import tsx --test src/lib/email*.test.ts`. Expected: PASS.
- [ ] **Step 6: Run `npm audit`.** Expected: 0 critical, 0 high. List any moderate or low finding that remains, with its reason, in the commit body.
- [ ] **Step 7: Run the gates.** `npm run typecheck`, `npx eslint .`, `npm test`, `node --test scripts/developer-preview.test.mjs scripts/developer-preview-storage.test.mjs scripts/verify-standalone-artifact.test.mjs`. Expected: all exit 0, except that in Claude's sandbox the 3 known environment failures appear (`agent-eval-scenarios`, `slo-bar`, `forms-delivery` staging).
- [ ] **Step 8: Commit** `fix: upgrade next, sentry, zod, nodemailer and pinned transitive deps for audit findings`.

### Task 2: Teacher due time reaches the API as a zoned timestamp

**Files:**
- Create: `src/lib/dashboard/due-date.ts`, `src/lib/dashboard/due-date.test.ts`
- Modify: `src/components/teacher/StudentDetail.tsx:325` (request body)

**Interfaces:**
- Produces: `toIsoDueAt(value: string): string`. It returns `""` for `""`, passes `YYYY-MM-DD` through unchanged, and turns `YYYY-MM-DDTHH:mm` (local browser time) into `new Date(value).toISOString()`.

- [ ] **Step 1: Write failing tests** in `due-date.test.ts`:
  - `rejects the raw datetime-local value today`: `taskDetails.safeParse({ title: "x", dueAt: "2026-10-27T09:30" }).success === false`. This documents the bug and should already pass.
  - `zones a datetime-local value`: `toIsoDueAt("2026-10-27T09:30")` ends with `"Z"`, its `getTime()` equals `new Date("2026-10-27T09:30").getTime()`, and `taskDetails.safeParse({ title: "x", dueAt: toIsoDueAt("2026-10-27T09:30") }).success === true`.
  - `keeps the instant across DST`: same equality for `"2026-11-01T01:30"`.
  - `passes empty and date-only through`: `toIsoDueAt("") === ""` and `toIsoDueAt("2026-10-27") === "2026-10-27"`.
- [ ] **Step 2: Run** `node --import tsx --test src/lib/dashboard/due-date.test.ts`. Expected: FAIL, because `due-date` is not found.
- [ ] **Step 3: Implement `toIsoDueAt`.** Use it in `handleCreateTask`: `body: JSON.stringify({ ...taskForm, dueAt: toIsoDueAt(taskForm.dueAt) })`.
- [ ] **Step 4: Run** the test again. Expected: 4/4 PASS.
- [ ] **Step 5: Commit** `fix: send teacher task due times as zoned ISO timestamps`.

### Task 3: Signature file-ownership check moves to `src/lib`

**Files:**
- Create: `src/lib/forms/signature-files.ts`
- Modify: `src/app/api/forms/sign/route.ts:64-69`
- Test: `src/app/api/forms/sign/route.test.ts` (existing)

**Interfaces:**
- Produces: `fileBelongsToStudent(fileId: string, studentId: string): Promise<boolean>`. It runs `prisma.fileUpload.findFirst({ where: { id: fileId, studentId }, select: { id: true } })` and returns `!!row`.

- [ ] **Step 1: Run** the route tests to get a baseline: `node --import tsx --test --experimental-test-module-mocks src/app/api/forms/sign/route.test.ts`. Expected: 10/10 PASS, including the "file does not belong" case.
- [ ] **Step 2: Implement** the helper. The route keeps `if (fileId && !(await fileBelongsToStudent(fileId, targetStudentId))) throw forbidden("File does not belong to this student.");`.
- [ ] **Step 3: Rerun** the route tests. Expected: 10/10 PASS. Fix the test's prisma mock only if its module path changed, and say so in the commit.
- [ ] **Step 4: Commit** `refactor: move signature file ownership query into src/lib`.

### Task 4: One editor outside the table, plus a read-only view for staff tasks

**Files:**
- Modify: `src/components/dashboard/TaskTable.tsx` (actions cell, `TaskActions`, single dialog host)
- Modify: `src/components/dashboard/TaskDialog.tsx` (controlled `open`/`onOpenChange`, no `Dialog.Trigger` for row edits)
- Create: `src/components/dashboard/TaskDetailsDialog.tsx`, `src/components/dashboard/TaskTable.test.tsx`

**Interfaces:**
- Produces: `TaskActions.open(task: TaskDto, mode: "edit" | "view"): void`. `TaskTable` holds `active: { task: TaskDto; mode: "edit" | "view" } | null` and renders exactly one `TaskDialog` (mode `edit`) or `TaskDetailsDialog` (mode `view`) after the `<table>`. It keeps the snapshot even when the row is missing from `data.tasks`.
- Produces: `TaskDialog` props become `{ task?: TaskDto; open: boolean; onOpenChange(open: boolean): void; disabled: boolean; save; remove? }`. The "Add personal task" button keeps its own trigger in the header.
- Produces: `TaskDetailsDialog({ task, open, onOpenChange })` shows title, status, priority, due date (UTC date format matching the table), and `description`, or "No extra instructions." when it is empty. It closes with a 44px "Close" button.

- [ ] **Step 1: Write failing tests** in `TaskTable.test.tsx`, using `renderToString` with a two-row `TaskPage` fixture (one personal task, one staff task with `description: "Bring two references"`):
  - `personal rows offer Edit and staff rows offer View details`: the HTML contains `Edit<span class="sr-only"> <personal title>` and `View details<span class="sr-only"> <staff title>`, and does not contain `Staff-managed`.
  - `no dialog markup renders inside the table`: the substring between `<table` and `</table>` contains no `role="dialog"`.
- [ ] **Step 2: Run** `node --import tsx --test --experimental-test-module-mocks src/components/dashboard/TaskTable.test.tsx`. Expected: FAIL on "View details".
- [ ] **Step 3: Implement** the interfaces above. The row cell renders a button calling `meta.open(row.original, row.original.personal ? "edit" : "view")`.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Browser check in the developer preview** (add the journey to `scripts/developer-preview-journeys.mjs`):
  1. As the seeded student, set the status filter to "Open" and open Edit on an open personal task.
  2. Type "draft text" into the title.
  3. In a second page of the same context, mark that task Completed through the API.
  4. Trigger the dashboard refresh.
  5. Expected: the dialog is still open, still shows "draft text", and the row is gone from the table.
  6. Also open View details on a staff task and expect its description text.
- [ ] **Step 6: Commit** `fix: keep task drafts across refresh and let students read staff assignments`.

### Task 5: Conflict recovery that keeps the draft

**Files:**
- Modify: `src/lib/dashboard/tasks.ts` (add `readTask`), `src/lib/dashboard/tasks.test.ts`
- Modify: `src/app/api/tasks/[id]/route.ts` (add `GET`), test in `src/app/api/tasks/route.test.ts` or a new `[id]/route.test.ts` following the existing route-test mocks
- Modify: `src/components/dashboard/TaskDialog.tsx`, `src/app/(student)/dashboard/DashboardClient.tsx` (`save` takes an explicit version)

**Interfaces:**
- Consumes: Task 4's controlled `TaskDialog`.
- Produces: `readTask(session: Session, id: string): Promise<TaskDto>`. It runs `requireStudent`, scopes the row to `session.id`, and throws `notFound("Task not found.")` when the task is missing or belongs to someone else, which avoids revealing that it exists. It runs inside `withAppTransaction`.
- Produces: `GET /api/tasks/[id]` → `{ task: TaskDto }`, with `taskId` validated as a cuid.
- Produces: `save(values: TaskDetails, task?: TaskDto, version?: string)`. A PATCH sends `updatedAt: version ?? task.updatedAt`. `dashboardFetch` errors must expose `status: number`; add the field there if it is missing.

- [ ] **Step 1: Write failing lib tests** in `tasks.test.ts`, following its existing mock style:
  - `readTask returns the owner's task`.
  - `readTask hides another student's task as not found`: rejects with status 404.
  - `readTask rejects staff sessions`: same error as `requireStudent`.
- [ ] **Step 2: Write a failing route test.** `GET /api/tasks/<cuid>` as the owner returns 200 with `task.id`. A non-cuid id returns 400.
- [ ] **Step 3: Run both test files.** Expected: FAIL (`readTask` and `GET` are undefined).
- [ ] **Step 4: Implement** `readTask` and `GET`. Rerun. Expected: PASS.
- [ ] **Step 5: Implement the client conflict state** in `TaskDialog`. On a save error with `status === 409`, fetch `GET /api/tasks/{id}`.
  - On 200, keep the form values and show "This task changed somewhere else." with two buttons: "Save my version" (calls `save(draft, task, latest.updatedAt)`) and "Use the latest version" (`form.reset(latest)`).
  - On 404, show "This task was deleted. Your draft is still here." and disable Save.
- [ ] **Step 6: Browser check in the developer preview.** Open Edit and type a draft. Change the same task through the API from a second page, then click Save. Expected: the conflict message appears, the draft is intact, and "Save my version" returns 200. Repeat with the task deleted from the second page. Expected: the deleted message appears, the draft is intact, and no request loop shows in the network log.
- [ ] **Step 7: Commit** `fix: recover from task edit conflicts without losing the draft`.

### Task 6: Intake Step 1 email check and a non-destructive skip toggle

**Files:**
- Create: `src/lib/intake/step-validation.ts`, `src/lib/intake/step-validation.test.ts`
- Modify: `src/app/intake/IntakeClient.tsx` (`validateStep1`, the skip checkbox `onChange` at :612-620, submit payload at :199-202, focus on step change)

**Interfaces:**
- Produces: `validateIntakeStep1(fields: { firstName: string; lastName: string; birthDate: string; county: string; phone: string; email: string }): string | null`. It returns the existing messages in the existing order, then `"Please enter a valid email address, or leave it blank."` when `email.trim()` is non-empty and fails the intake schema's email rule.
- Produces: `demographicsForSubmit(input: { skip: boolean; gender: string; race: string; ethnicity: string; primaryLanguage: string }): { gender: string | null; race: string | null; ethnicity: string | null; primaryLanguage: string }`.

- [ ] **Step 1: Write failing tests:**
  - `blank email passes`: returns `null` for valid fields with `email: ""`.
  - `invalid email blocks`: `email: "invalid"` returns the email message.
  - `existing messages keep their order`: an empty `firstName` still returns the name message first.
  - `skip sends Prefer not to say for all four`: given `{ skip: true, race: "Asian", ... }`, every field equals `"Prefer not to say"`.
  - `unskip keeps prior answers`: given `{ skip: false, race: "Asian", primaryLanguage: "Spanish" }`, the output has `race: "Asian"` and `primaryLanguage: "Spanish"`.
- [ ] **Step 2: Run** `node --import tsx --test src/lib/intake/step-validation.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both functions. In `IntakeClient`:
  - `validateStep1` calls `validateIntakeStep1` and sets the message.
  - The skip checkbox `onChange` only calls `setWishNotToIdentify`. Delete the three setters at :616-618.
  - The payload spreads `demographicsForSubmit(...)`.
  - After `setStep(n)`, focus the new step's heading, which gets `tabIndex={-1}` and a ref.
- [ ] **Step 4: Run** the tests. Expected: PASS. Run `wc -l src/app/intake/IntakeClient.tsx` and expect fewer lines than 973.
- [ ] **Step 5: Browser check in the developer preview at 390×844.**
  - Expected: an invalid email shows the inline message and stays on Step 1.
  - Expected: choosing Spanish, checking Skip, then unchecking it shows Spanish again.
  - Expected: after Continue, `document.activeElement` is the Step 2 heading.
- [ ] **Step 6: Commit** `fix: validate intake email and keep demographic answers when skip is undone`.

### Task 7: Strict-CSP-safe Zod in browser bundles

**Files:**
- Modify: `src/lib/intake/schema.ts:1` (`import { z } from "@/lib/zod-csp"`)
- Modify: `src/components/dashboard/TaskDialog.tsx` (`import type { z } from "zod"`)
- Modify: `eslint.config.mjs` (add a `no-restricted-imports` block)

**Interfaces:** Produces a lint guard. Files matching `src/components/**`, `src/app/**/*Client.tsx`, `src/lib/intake/**` and `src/lib/dashboard/**` may not value-import `"zod"` (use `allowTypeImports: true`, message: "Import z from @/lib/zod-csp in browser-reachable code."). `src/lib/zod-csp.ts` is the only exemption.

- [ ] **Step 1: Add the lint block** before touching the imports. Run `npx eslint src/lib/intake/schema.ts src/components/dashboard/TaskDialog.tsx`. Expected: 2 errors (red baseline for the guard).
- [ ] **Step 2: Fix both imports.** Rerun. Expected: 0 errors. Then run `npx eslint .`. Expected: exit 0; fix any other hit the rule finds the same way.
- [ ] **Step 3: Rebuild the preview** and load `/intake` and `/dashboard` with a `securitypolicyviolation` listener plus server-log capture. Expected: 0 browser violations and no `script-src`/eval lines in the server log. If violations remain, stop and use superpowers:systematic-debugging on the remaining source. Do not loosen the CSP.
- [ ] **Step 4: Commit** `fix: keep browser Zod schemas jitless under strict CSP`.

### Task 8: Release notes and project memory

**Files:**
- Modify: `docs/dashboard-implementation.md` (status paragraph at :5), `docs/developer-preview.md` (CSP line), `.claude/MEMORY.md` (Last Session, Open Items)

- [ ] **Step 1: Rewrite the status paragraph** with three labeled lists:
  - Verified locally on 2026-10-26: tests, build, audit counts after Task 1, the CSP result from Task 7.
  - Resolved: the deepmerge override, with its compatibility-test evidence.
  - Still unverified (deployment only): deployed identity and RLS parity, Linux behavior, production permissions, revocation of old dev-login sessions (`sessionVersion` bump), migration approval.
- [ ] **Step 2: Update the CSP line in `developer-preview.md`** to match Task 7's measured result.
- [ ] **Step 3: Update `.claude/MEMORY.md`:**
  - Last Session dated 2026-10-26.
  - Open Items: the API envelope follow-up, the `ai_knowledge_passages` audience filter (needs a new migration), the IntakeClient split if it is still over 800 lines, and the dev-login session bump.
- [ ] **Step 4: Check the docs for em dashes.** `grep -c '—'` on each changed doc must not rise above its pre-edit count.
- [ ] **Step 5: Commit** `docs: record pre-demo verification state and remaining deployment checks`.

### Task 9: Whole-branch verification and demo rehearsal

- [ ] **Step 1: Run the gates in Britt's terminal**, outside the sandbox: `npm run prisma:validate && npm run typecheck && npx eslint . && npm test && npm run build`. Expected: all exit 0, the build prints no `storage.ts` tracing warning, and 25 form PDFs are staged.
- [ ] **Step 2: Run `npm audit`.** Expected: the same result as Task 1, Step 6.
- [ ] **Step 3: Rehearse the demo in the developer preview**, using every journey from Tasks 4–6:
  1. Intake at 390px.
  2. Student login.
  3. Dashboard: add, edit and complete a personal task, read a staff assignment, trigger a conflict.
  4. Teacher login: create an assignment with a due time, open the preview page.
  5. Expected: no page errors, no CSP violations, and no horizontal overflow at 390px.
- [ ] **Step 4: Run superpowers:requesting-code-review** on the full diff since this plan's first commit.
