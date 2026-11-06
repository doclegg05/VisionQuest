# Microsoft 365 integration and the organization tree

Status: PROPOSED, 2026-11-06. Written from a brainstorming session with Britt. Revised the same day after Sol's review, which checked the Microsoft claims against Microsoft Learn.

## Problem

Instructors and administrators in Britt's organization live in Microsoft 365 all day. They use Outlook, Teams, Word, Excel and Copilot. VisionQuest is one more place they have to remember. Britt's long-term picture is VisionQuest as the operating system for the whole program, staff and students both, and that only works if it fits into the tools staff already open every morning.

Britt cannot connect VisionQuest to the organization's Microsoft tenant today. IT approval comes later. So everything here gets built and tested against accounts Britt controls, ships switched off, and turns on with configuration once IT says yes. A personal account cannot prove everything a work tenant needs (organization consent, guests, Conditional Access, group assignment), so the same code must also pass a test in a small organization tenant before it is called ready for IT.

The Microsoft work has a dependency that is bigger than Microsoft. Britt wants staff to register themselves with their work account. Today every `teacher` sees every student in the program (`STAFF_CAN_MANAGE_ANY` in `src/lib/classroom.ts:23`, the "single staff workspace"). Self-registration on top of that rule would hand TANF/SNAP student records to anyone in the tenant. So the first phase is the access model Britt described, an organization tree, and Microsoft sign-in sits on top of it.

## Solution

| Phase | What | Needs IT? | Test account |
|---|---|---|---|
| 1 | Organization tree and class-scoped access | No | None, internal |
| 2 | Sign in with Microsoft for staff, registration settings, staff invites | Yes, to go live | Personal Microsoft account |
| 3 | Microsoft connection foundation, then one app at a time | Yes, per app | Personal account, then a Business Basic trial |
| 4a | Azure-hosted model as a Sage provider | Azure account, not IT | Azure pay-as-you-go |
| 4b | Copilot Chat API as an experimental staff assistant | Yes, plus Copilot licenses | Organization tenant only |
| 4c | VisionQuest as an agent inside Copilot | Yes | Organization tenant only |

Phases 1 and 2 are designed in full below. Phase 3's foundation is designed in full; each app after it gets a short design of its own. Phase 4 is outlined, because it waits on FERPA decisions Britt has not made.

## Variables

| Name | Where | Value |
|---|---|---|
| `MICROSOFT_CLIENT_ID` | `.env.local`, Render | From the app registration |
| `MICROSOFT_CLIENT_SECRET` | `.env.local`, Render | From the app registration |
| `MICROSOFT_TENANT_ID` | `.env.local`, Render | `consumers` for the personal-account test, the organization's tenant id in production. Never `common` or `organizations` in production |
| `MICROSOFT_REDIRECT_URI` | `.env.local`, Render | `https://visionquest.onrender.com/api/auth/microsoft/callback` in production |
| Registration level | Program settings | `invite_only` by default |
| Microsoft app switches | Program settings | Each app off by default |

## Goals

- Each person in VisionQuest sits at one place in a tree and sees everything below them and nothing beside them.
- Instructors build their own classrooms, Schoology style, and invite each new student straight into a classroom.
- Staff sign in with the Microsoft work account they already use. Students keep their current sign-in.
- Staff can register themselves with Microsoft, under a sharing-style setting an admin controls.
- A demo on a personal Microsoft account shows sign-in plus at least one Microsoft app working end to end. Target date: the AI Leadership Academy course ends 2026-12-18.
- The same code passes the personal-account test and the organization-tenant test. Going live in Britt's tenant is then a configuration change and an IT checklist.

## Non-goals

- Students signing in with Microsoft. Students do not have organization accounts.
- Copilot answering students. Copilot access is per staff license.
- Replacing Sage with Copilot. Microsoft models become one more Sage provider, routed by the existing sensitivity rules.
- Building any Microsoft app integration before the connection foundation exists.

## Anti-goals

These would make the work a failure even if every feature ran.

- Any registered staff account, invited or not, seeing a student it has no place in the tree to see.
- A coordinator or instructor losing access to their own students on the day Phase 1 deploys.
- Microsoft sign-in creating a student account. The Google callback had this flaw before review finding F9; Microsoft must not repeat it.
- Student data leaving VisionQuest for Microsoft before Britt makes the FERPA call for that app.
- A demo that only works on Britt's personal account and needs rework for the tenant.

## Phase 1. The organization tree

### Roles

| Role | Stored as | Sees | Can invite |
|---|---|---|---|
| Admin | `admin` | The whole state, plus settings and user management | Program coordinators, anyone |
| Program coordinator | `program_coordinator`, new | The whole state, read-only: the same dashboard and optional drill-down, statewide | Regional coordinators, anyone below |
| Regional coordinator | `coordinator`, existing string | Their region or regions, read-only: a results dashboard first, with an optional drill-down to students | Instructors, to their own region |
| Instructor | `teacher`, existing string | Students in classes they are assigned to | Students, into their own classes; co-teachers to their own classes |
| Student | `student` | Themselves | Nobody |

Britt decided the access rules for instructors, regional coordinators and program coordinators, and that regional coordinators invite instructors. The admin row and the rest of the invite chain are my calls.

Keeping the stored strings `coordinator` and `teacher` and changing only their labels avoids rewriting every role check in the codebase. That is my call; the builder may rename if a search shows the change is small.

### The tree

```
State: admins, program coordinators
├── Region A: regional coordinator
│   ├── Instructor 1
│   │   ├── Classroom "Fall AM", students
│   │   └── Classroom "Fall PM", students
│   └── Instructor 2
└── Region B: regional coordinator
```

Most of this shape exists. `SpokesClass` has a unique `code`, a `regionId`, a `createdById` and an `instructors` join table. `Region` has `RegionCoordinator`. What is missing:

1. A link from an instructor to a region. Add a `RegionInstructor` join table mirroring `RegionCoordinator`. A join table rather than a column allows the two-region instructor case. My call.
2. The `program_coordinator` role.
3. Access rules that follow the tree. See below.

### Access rules

- Instructor: students with a non-archived enrollment in a class where the instructor is in `SpokesClassInstructor`.
- Regional coordinator: everything in classes whose `regionId` is a region they coordinate.
- Program coordinator and admin: everything.
- Remove `teacher` and `coordinator` from `STAFF_CAN_MANAGE_ANY`. Keep `canPerformElevatedStaffAction` as the separate privilege tier; read the comment at `src/lib/classroom.ts:40` before touching either.

Where the work is, per the builder check on 2026-11-06:

- Teachers. RLS already limits a teacher to students in classes they instruct, through `visionquest.managed_student_ids()` (`prisma/migrations/00000000000000_baseline/migration.sql`, from line 1717). Teachers see program-wide today because of the app layer: the unscoped branch of `buildManagedStudentWhere`, every caller of `canManageAnyClass` / `canManageAnyClassFor`, and reads that go through `prismaAdmin`, such as `src/lib/teacher/dashboard.ts`. The teacher change is in those call sites, not in RLS.
- Coordinators. `rlsContextFor` (`src/lib/api-error.ts:14`) collapses a coordinator session to RLS role `student`, which is the known defect that gives real coordinators 403s and silent zeros (MEMORY.md Open Items, "Coordinator dashboard is RLS-blind"). Fix it here: give coordinators and program coordinators real RLS contexts and policies, and move `region.ts` reads off the app client only once the policies exist.

Britt reopened the D2 coordinator freeze in this session, 2026-11-06: regional and program coordinators are needed. Record that in `docs/PRODUCT_DECISIONS.md` as an entry superseding the 2026-10-26 D2 entry.

### Instructors build classrooms

- Instructors can already create classes: `classes.create` allows `teacher` (`src/lib/registry/tools.ts`), and `POST /api/teacher/classes` takes any list of instructor ids with an optional `regionId`. The change is to tighten that route, not to build a new one.
- An instructor creates a classroom with a name, dates and program type. The class gets a code, and the instructor is added to `SpokesClassInstructor`.
- The class's region is the instructor's region. With two regions the instructor picks one.
- An instructor with no region cannot create a classroom.
- `MAX_ACTIVE_CLASSES_PER_TEACHER = 2` stays as is. My call; ask Britt before raising it.
- Co-teachers: an instructor can add another instructor from the same region to a class they teach. Cross-region co-teaching needs a coordinator of the class's region to approve. My call, from the edge cases Britt did not rule out.
### The student flow

Britt's description, 2026-11-06:

1. A new student joins SPOKES or Adult Ed.
2. The instructor invites them into the classroom on VisionQuest right away.
3. The student signs in and starts orientation.
4. The instructor sees them in the class. The regional coordinator sees them through the drill-down. The program coordinator can too, though they will mostly use the dashboard.

So students never create their own accounts and never join by code. Staff create them, as they do today. The instructor invite reuses the staff door of `src/lib/intake/provision.ts`, which may name a class and receives the new account's one-time password, and the existing credential handoff. Restrict it so an instructor can name only a class they teach. The class code stays an internal identifier.

Students who arrive through the public intake form (`POST /api/intake/submit`) have an account but no class. They appear on an "Applicants waiting for a class" list that admins and program coordinators see. Regional coordinators see the applicants whose intake names their region, if the form collects a region; the builder checks whether it does. Placing an applicant in a class makes them visible to that class's instructor. My call.

### What coordinators see

Coordinators read; they do not work students. Above the instructor level, the main screen is a results dashboard with charts, not a list of students. Britt, 2026-11-06.

- A regional coordinator's dashboard covers their region. A program coordinator's covers the state, with a breakdown by region.
- Drilling down is optional: from a chart to a region, then an instructor, then a classroom, then a student, showing roster, orientation and progress at each level. Most visits stop at the charts.
- Both live in the existing `/coordinator` area (`src/app/(coordinator)/coordinator`) and its `withCoordinatorAuth` routes, not the instructor screens. Coordinators do not need `isStaffRole` or the `withTeacherAuth` routes.

The dashboard reports results students produce on VisionQuest, as measurable counts over time. Britt's starting list, 2026-11-06: new students enrolled, goals made, goals achieved. The full metric list, definitions and charts are a short design of their own, after Phase 1. Phase 1 builds the access rules the dashboard reads through, and a plain drill-down so coordinators can reach their region's classes on day one.

### Program coordinator compared with admin

Both see the whole state. Admin alone keeps program settings, user management, offboarding and demo tools. `program_coordinator` joins the elevated staff tier. A regional coordinator's elevated actions become bound to their own region. My calls.

### Other roles and shared data

- The existing `cdc` role stays as it is and outside the tree. My call; it has its own home at `/cdc`.
- Data tied to a student follows the student's place in the tree, inside the rules each kind of record already has. The tree widens who can reach a student; it never widens what they can read. Teachers have no transcript access (`src/lib/sage/wellbeing-card.ts:15`, a locked product decision), and coordinators get none either.
- That covers the intervention queue, forms responses, exports, and outcome and Grant KPI reports, which count only what the reader can see.
- Program-wide catalogs stay shared: form templates, program documents, job listings and employers. My call.

### The old registration keys

`src/app/api/auth/register-teacher/route.ts` mints teachers from `TEACHER_KEY` and admins from `ADMIN_KEY`. After Phase 1, a `TEACHER_KEY` registration creates unplaced staff. `ADMIN_KEY` stays as the break-glass way to create an admin, since an admin sees everything. My calls.

### Staff invites

- A new `StaffInvite` table: email, role, region (when the role needs one), inviter, a hashed token, expiry, accepted date, revoked date.
- Who may invite follows the table above. A regional coordinator may invite only to a region they coordinate.
- The invite email links to VisionQuest. The person signs in with Microsoft, or with a password while Microsoft sign-in is off. The account's verified email must match the invite email, so a forwarded link is useless to anyone else.
- Invites expire after 14 days. My call.
- Every invite, acceptance and revocation writes an audit row with ids only, no email in logs (`.claude/rules/security.md`).

### Unplaced staff

A staff account with no place in the tree sees one screen that says to ask their regional coordinator for an invite. It sees no students and cannot create classrooms. Admins and program coordinators get a "Needs a place in the tree" list where they can place or remove these accounts.

### Moving today's data across

Nobody loses access to their own students on deploy.

- Each current `teacher` gets a `RegionInstructor` row for every region of every class they teach.
- A teacher whose classes have no region, or who teaches no class, lands on the "Needs a place in the tree" list.
- Classes with no region stay visible to their own instructors and to program coordinators and admins, and appear on the same list. Their instructors are not treated as unplaced: they keep their classes, can work in them, and cannot create new classrooms until someone gives them a region. The unplaced-staff screen is only for staff with no class and no region.
- Before deploy, run a read-only count against production: teachers, classes without a region, active coordinator accounts. Britt runs it from the Terminal panel, because sessions cannot reach production (auto-memory `session-sandbox-blocks-push-and-live-evals`).

The repo's coordinator-readiness Open Item says active coordinator accounts are unverified. This count answers it.

## Phase 2. Sign in with Microsoft

### How it works

- OpenID Connect against Microsoft Entra ID, authorization code flow with PKCE, handled on the server. New routes `/api/auth/microsoft` and `/api/auth/microsoft/callback`, built in the same shape as `src/app/api/auth/google/callback/route.ts`.
- Identify a Microsoft user by tenant id plus object id, the `tid` and `oid` claims. Store the pair in its own table with a unique constraint, so one Microsoft identity binds to one VisionQuest account.
- Never use the `email`, `preferred_username` or `upn` claims to decide who someone is. Microsoft documents them as mutable, possibly missing, and not to be used for authorization ([ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), [optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)). This is a deliberate break from the Google callback, which trusts Google's `email_verified`.
- A Microsoft identity binds to an account in one of three ways only:
  1. Accepting a staff invite. The invite link proves the person received the email; the binding is written in the same transaction that marks the invite accepted, so a replayed or second concurrent use fails.
  2. An existing staff member signs in with their password and MFA, then links Microsoft from settings.
  3. An admin links it by hand.
- Tests cover a token with no email, an email that changed, an identity already bound elsewhere, a replayed invite, and two concurrent acceptances of one invite.
- Microsoft sign-in never creates a `student` row. It creates staff accounts only, and only through the registration setting below.
- Students see no Microsoft button. A student account that signs in with Microsoft is refused.
- Guest accounts are refused. A single-tenant app registration still lets the tenant's guests sign in, and a guest is not an employee. Configure the `acct` optional claim and refuse a guest value; prove it in the organization-tenant test. My call.
- Password sign-in stays for staff as a fallback. My call.

### Registration setting

An admin setting, stored like other program settings. It works like SharePoint's link sharing options.

| Level | Who can register with Microsoft | Available |
|---|---|---|
| Invite only | People with a valid staff invite | Default, from day one |
| Anyone in my organization | Any work account from the configured tenant. They become unplaced staff until invited into the tree. | Once a tenant id is configured |
| Members of a Microsoft group | Members of a named Entra group, which can also set the role | Later. Needs IT to create the group and grant group claims |

"Anyone in my organization" is safe only because of Phase 1. A new account sees nothing until someone above it in the tree places it. Phase 2 must not ship before Phase 1.

### Multi-factor sign-in

VisionQuest keeps its own TOTP check for every Microsoft sign-in. Phase 2 does not build a "trust Microsoft's two-step check" switch. `amr` is an optional claim that has to be configured, and nobody has seen what Britt's tenant sends. Build the switch only after the organization-tenant test shows the claim arriving as expected. When it exists, a missing or unexpected claim keeps TOTP required. Password sign-in keeps TOTP too.

### Configuration

Environment variables, read at boot, with the feature off when any is missing:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`. For the personal-account test this is `consumers`. For production it is the organization's tenant id. `common` and `organizations` are not allowed in production, because they accept any tenant.

The tenant value must match the app registration's supported account types. A personal-account test needs a registration that allows personal accounts, and production needs a single-tenant registration in Britt's tenant. These are two separate registrations, not one setting changed later ([register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)).
- `MICROSOFT_REDIRECT_URI`

Local values go in `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`. Production values go in Render's environment settings. The builder creates placeholder lines, never real values, and the README lists them.

### The IT handoff

Write `docs/runbooks/microsoft-365-it-setup.md`, a page Britt can send to IT as is. It covers registering the app in Entra, the redirect URI, the permissions VisionQuest asks for and why each is needed, admin consent, and the values to send back. List only the sign-in permissions in Phase 2. Phase 3 adds a section per app.

## Phase 3. Microsoft apps

### The connection foundation

This is built once. Every app uses it.

- Sign-in asks for sign-in permissions only. Each app asks for its own permissions the first time a staff member turns it on, using Microsoft's incremental consent. If IT grants tenant-wide admin consent, Microsoft may already hold that permission before anyone turns the app on, so VisionQuest's own switches are what decide whether it calls an app, not Microsoft's grant ([consent types](https://learn.microsoft.com/en-us/entra/identity-platform/consent-types-developer)).
- Record which scopes each connection was granted, and check before every call. A missing scope means "reconnect", not an error page.
- Ask for `offline_access` explicitly; without it there is no refresh token ([scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)). Store the newest refresh token after every exchange. Microsoft does not invalidate the old one on exchange ([refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)), so disconnect deletes every stored token for that connection.
- When Microsoft rejects a refresh because consent was revoked or the password changed, mark the connection disconnected and tell the staff member in plain words.
- Store tokens encrypted at rest, using the same approach as `geminiApiKey` and `API_KEY_ENCRYPTION_KEY`. Never log a token.
- Writes are safe to retry. Create calendar events with a `transactionId` so a retry cannot make a duplicate ([create event](https://learn.microsoft.com/en-us/graph/api/user-post-events)), and give every other write an equivalent guard before it gets retry.
- Admins turn each app on or off for the whole program. Staff turn each enabled app on or off for themselves, and can disconnect Microsoft entirely.
- Every Microsoft Graph call goes through one client module in `src/lib/microsoft/`, with timeouts, retry on 429 and 503 honoring `Retry-After`, and errors logged through `errorForLog`.
- Every write to a staff member's Microsoft account writes an audit row.

### The apps

Each gets its own short design, in the order Britt picks. Britt has not yet named her top three. The table records what research on 2026-11-06 found each app needs.

| App | What VisionQuest does | Works on a personal account? |
|---|---|---|
| Outlook Calendar | Student appointments on the instructor's calendar, synced both ways | Yes |
| Outlook Mail | Send notices and reports from the staff member's own mailbox | Yes |
| OneDrive | Save exports and packets as files | Yes |
| Excel and Word | Generate `.xlsx` and `.docx` files and save them to OneDrive | Creating files, yes. Editing cells inside a workbook through Graph works only on business OneDrive and SharePoint |
| To Do | Queue tasks in the instructor's task list | Yes |
| Teams | Alerts in Teams chat, VisionQuest as a Teams tab | No. Work accounts only |
| SharePoint, Planner | Shared program folders, team task boards | No |

Sol checked the personal-account column against the Graph permission tables on 2026-11-06: supported for [Calendar](https://learn.microsoft.com/en-us/graph/api/user-post-events), [Mail](https://learn.microsoft.com/en-us/graph/api/user-sendmail), [OneDrive upload](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content) and [To Do](https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks); not supported for [Excel workbook sessions](https://learn.microsoft.com/en-us/graph/api/workbook-createsession), [Teams chat messages](https://learn.microsoft.com/en-us/graph/api/chat-post-messages) and [Planner tasks](https://learn.microsoft.com/en-us/graph/api/planner-post-tasks). Each app's design re-checks its own endpoints.

### FERPA gate

Every app that copies student information into Microsoft needs Britt's written call first: which fields go, for which app. The data stays inside the organization's own Microsoft account, which the organization's Microsoft agreement probably covers, but nobody has checked that agreement. Add this to the FERPA decisions in `docs/audits/2026-09-06-ferpa-pii-review.md` Part 8. Until Britt decides an app, its design sends no student name, id or record. Calendar events, for example, say "VisionQuest appointment" and link back.

## Phase 4. Microsoft AI

### 4a. Azure as a Sage provider

Add an Azure AI Foundry provider to `src/lib/ai/` beside Gemini and Ollama. `resolveAiProvider` routes to it like any other provider. It never bypasses the sensitivity rules.

This is lane B in the FERPA review, decision D-B ("Vertex first, Azure if written FERPA paper is required"). Phase 4 starts only after Britt rules on D-A and D-B. It needs an Azure pay-as-you-go account. The free trial often starts with zero GPT quota, so do not plan on it.

Azure has no hard spending cap on pay-as-you-go. The spending limit exists only on free and some benefit subscriptions, and budgets send alerts without stopping anything ([spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit), [budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)). So VisionQuest carries its own controls: Azure budget alerts, a per-day token and request limit in the provider, a concurrency limit, and an admin kill switch. Some overrun is still possible between a budget alert and someone acting on it.

Azure also hosts DeepSeek and Llama models; per Britt's standing preference, comparisons test those rather than OpenAI models (auto-memory `model-comparisons-skip-anthropic-openai`). Pick the exact model, deployment type and region before calling Azure an approved destination. Models sold directly by Azure and partner models come under different terms ([sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure), [partner models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners)), and the FERPA ruling has to name which.

### 4b. Copilot Chat API, experimental

The Microsoft 365 Copilot Chat API lets VisionQuest ask Copilot a question for a signed-in staff member. Facts as of 2026-11-06 ([overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/overview), [endpoint](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations)):

- It is a `/beta` API, and Microsoft says production use is not supported.
- Each user needs a Microsoft 365 Copilot add-on license.
- It works with delegated work accounts only. No personal accounts and no app-only access, so it cannot be tested on Britt's personal account.
- It needs all seven of these delegated Graph permissions: `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`. That is a large ask for IT to review.

Build it, if at all, behind its own admin switch, labelled experimental. It never serves students.

### 4c. VisionQuest inside Copilot

A Copilot agent that answers staff questions about their classes from VisionQuest data. This is a different product with its own licensing and possible metered billing ([extensibility costs](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/cost-considerations)). It gets its own design after 4b's findings.

## Test environments

From research on 2026-11-06:

- Microsoft's free developer sandbox is probably not available to Britt, but that is unverified. Personal accounts can join the program; a sandbox needs a qualifying benefit, such as an annual Visual Studio Professional or Enterprise subscription, a Microsoft partner program, or Premier or Unified Support ([program FAQ](https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq)). Britt can check by joining and looking for "Set up E5 subscription".
- A personal Microsoft account covers Phase 2 and the Calendar, Mail, OneDrive and To Do apps. Use it from day one.
- A Microsoft 365 Business Basic one-month trial gives a real small organization with Teams and SharePoint. It is probably capped at 25 users; the Basic cap is unconfirmed. It needs a card, and by default it renews into a paid annual term unless recurring billing is turned off ([trials](https://learn.microsoft.com/en-us/microsoft-365/commerce/try-or-buy-microsoft-365)). Turn recurring billing off on day one. Confirm the trial plan includes Teams before starting. Start it only when the organization-tenant test is next, because the clock is 30 days.
- The organization-tenant test is a gate. Before the IT handoff is called ready, Phase 2 and every enabled Phase 3 app pass in that trial tenant: single-tenant sign-in, admin consent, guest refusal, a Conditional Access policy that requires MFA, and the `amr` claim check.
- Azure pay-as-you-go with the cost controls in 4a, for Phase 4a only.

Automated tests never call Microsoft. They use recorded responses and a fake token endpoint. Live checks against the personal account are manual and listed in each PR's test plan.

## Workflow

1. Britt approves this document.
2. Write the Phase 1 implementation plan with `superpowers:writing-plans`, then build it. Phase 1 deploys before any Phase 2 code reaches production.
3. Plan and build Phase 2. Demo it on Britt's personal Microsoft account.
4. Plan and build the Phase 3 connection foundation, then one app at a time in the order Britt picks, each after its FERPA call.
5. Run the organization-tenant test in a Business Basic trial. Fix anything it finds.
6. Hand IT `docs/runbooks/microsoft-365-it-setup.md` when Britt is ready to go live.
7. Phase 4a starts after Britt rules on FERPA decisions D-A and D-B. 4b and 4c need Britt's tenant and Copilot licenses.

## Deliverables

- Phase 1: `program_coordinator` role, `RegionInstructor`, `StaffInvite`, class-scoped access in the app helpers and RLS, the unplaced-staff screen and admin list, the data move, and a `docs/PRODUCT_DECISIONS.md` entry reopening D2.
- Phase 2: the Microsoft sign-in routes, the identity binding table, invite-based and settings-based linking, guest refusal, the registration setting, and `docs/runbooks/microsoft-365-it-setup.md`.
- Phase 3: `src/lib/microsoft/` with consent, encrypted token storage, admin and staff switches, then one app per PR.
- Phase 4a: an Azure provider in `src/lib/ai/` with its token, request and concurrency limits and kill switch. 4b and 4c get their own designs.

## Definition of done

### Phase 1

- An instructor cannot read a student outside their classes.
  - Check: the RLS integration suite in CI includes a case where an instructor in class A reads a student enrolled only in class B.
    Expected: zero rows. RLS already gives this today, so it guards against regression only.
- An instructor cannot see a student outside their classes through the app.
  - Check: route and helper tests for `buildManagedStudentWhere`, the teacher dashboard and student lookup, with an instructor of class A and a student only in class B.
    Expected: the student is absent, and the tests fail when `teacher` is put back in `STAFF_CAN_MANAGE_ANY`.
- A regional coordinator sees their region and no other.
  - Check: the same suite with a coordinator of region A reading a class in region B, and a class in region A.
    Expected: zero rows for B, the class for A.
- Nobody loses their own students on deploy, and nobody keeps students they should not see.
  - Check: the data move's test seeds today's shape, runs the move, and compares each teacher's visible students before and after.
    Expected: every student enrolled in a class the teacher teaches is still visible; every other student is no longer visible.

### Phase 2

- Microsoft sign-in never creates a student, and never signs in an uninvited account under `invite_only`.
  - Check: callback route tests against a fake token endpoint.
    Expected: both cases refused, with no row of `role: "student"` written and no staff row written under `invite_only`.
- The feature is off when configuration is missing.
  - Check: a route test with `MICROSOFT_CLIENT_ID` unset.
    Expected: no Microsoft button rendered, and the route answers 404.

- Microsoft sign-in ignores email for identity.
  - Check: callback tests with a token whose email matches an existing account but whose `tid`/`oid` are unbound, and with no invite.
    Expected: no binding written and no session issued.
- One invite binds one identity.
  - Check: a test that accepts the same invite twice concurrently.
    Expected: one binding, one refusal.

### Phase 3

- No token appears in logs.
  - Check: `npx eslint .` with the log-PII rule, plus a unit test that logs a Graph failure.
    Expected: lint clean, and the logged object has no token field.

### Every phase

- The suite passes.
  - Check: `npm test` and `npx eslint .`
    Expected: exit code 0.

## Decisions Britt made

- Staff sign in with their Microsoft work account. Students keep their current sign-in.
- Staff can register themselves with Microsoft, under a sharing-style setting.
- Each classroom is its own class. Instructors see only their own classes. Regional coordinators see their region. Program coordinators see the whole state.
- Instructors invite each new student straight into a classroom; the student signs in and starts orientation.
- Above the instructor, coordinators mainly need a dashboard of measurable student results on VisionQuest, starting with new students enrolled, goals made and goals achieved, with charts. Drilling down to individual students is available but optional. Regional coordinators see their region; program coordinators see the state.
- Instructors build their own classrooms, Schoology style.
- Instructors belong to regional coordinators, in an organization tree.
- Regional coordinators invite instructors to their region.
- Testing starts on a personal Microsoft account.
- The 2026-10-26 D2 coordinator freeze is reopened.

## My calls, for Britt to check

- Admin role sees everything and can invite anyone.
- Program coordinators invite regional coordinators.
- Keep the stored role strings `teacher` and `coordinator`.
- Instructors can belong to more than one region.
- Co-teachers in the same region need no approval; across regions they need a coordinator's.
- `MAX_ACTIVE_CLASSES_PER_TEACHER` stays at 2.
- Invites expire after 14 days.
- Password sign-in stays as a staff fallback.
- VisionQuest keeps its own two-step check for every sign-in; the trust switch waits for the organization-tenant test.
- Guest accounts in Britt's tenant cannot register.
- Microsoft identities bind only through an invite, a signed-in link from settings, or an admin, never by matching email.
- Microsoft apps ask for permission one at a time, not all at sign-in.
- No student information reaches Microsoft until Britt decides each app.

## Left to the builder

- Schema details for `RegionInstructor`, `StaffInvite` and the registration setting.
- Which existing routes and pages change for class-scoped access. Expect many: every caller of `canManageAnyClass`, `canManageAnyClassFor` and `buildManagedStudentWhere`, and every RLS policy keyed on staff role.
- Whether the public intake form collects a region.
- Graph client module structure, token refresh, and the fake Microsoft endpoints for tests.
- The order of PRs within each phase, so that each one deploys safely on its own.

## Open questions for Britt

1. Which three Microsoft apps matter most by 2026-12-18?
2. Can an instructor teach in two regions in practice, or is that never needed?
3. Who are today's production staff: how many teachers, and are any real coordinators active? The read-only count in Phase 1 answers this.
4. Beyond new enrollments, goals made and goals achieved, which student results belong on the coordinator dashboard? Answered in its own design after Phase 1.
