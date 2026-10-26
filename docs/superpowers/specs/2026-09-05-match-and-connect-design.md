# Design: Match & Connect — pairing one student with one employer, and making the introduction

**Date:** 2026-09-05
**Status:** Design proposal — awaiting Britt's review; implementation plan in `docs/superpowers/plans/2026-09-05-match-and-connect.md`
**Area:** Job placement (`src/lib/job-board/`, `src/lib/sage/agent/`, teacher surfaces, new `src/lib/connect/`)
**Builds on:** `docs/plans/2026-09-04-nlx-macc-job-search-research.md` (Parts 1–2), `docs/superpowers/plans/2026-07-15-sage-full-service-career-agent.md` (§3.2 banded matching — shipped; §4 Tier 3 "job-developer console" — deferred to "its own plan"; this is that plan)

---

## 1. The problem, stated plainly

A SPOKES student and a local employer who would suit each other almost never meet. The student sees a list of postings and applies into a void; the employer posts into a job bank and screens strangers. Nothing in the middle knows both sides. VisionQuest today is entirely on the student's side of that gap: it ranks postings for the student, tailors a résumé, and opens a link in a new tab. It has no employer entity, no employer contact channel, no way to share a student's record with anyone outside the program, and no record of what happened after the click.

The 2026-09-04 research pass found that the evidence base agrees with Britt's instinct. Self-directed search tooling does not move placement for TANF participants; a person or program **brokering** the job does. West Virginia already pays employers to hire SPOKES graduates (WV Works EIP: 50% of wage for 200–600 hours; ESP: up to 100% for six months; WIOA OJT; WOTC; Federal Bonding), and SPOKES's own work plan makes the Job Coach responsible for placement. What is missing is the tool that lets one instructor broker at scale: know who fits what, package the student honestly, put the packet in front of the right person with the subsidy attached, and follow up until there is an answer.

**Does it exist?** The survey found nothing available to a program like SPOKES. The nearest thing is EKCEP Works (Hazard, KY, launched August 2026), an intake-to-placement platform built by and for a workforce board, with every AI recommendation reviewed by a career professional. It is internal to that board. Commercial products cluster at the two ends: search copilots on the seeker side, applicant-tracking systems on the employer side. The broker in the middle, with a public subsidy packaged into the introduction, is not a product anyone sells. So we build it.

## 2. What "Match & Connect" is

Three capabilities, in the order the student experiences them:

1. **Match, both ways.** For a student: the handful of employers and open leads that fit their verified skills, certifications, availability, transport, and pay floor. For an employer lead: the students in the class who fit it. Scores are internal, coach-facing, and explained in words. Employers never see a score.
2. **Connect.** A *Connection* is one student introduced to one employer for one lead. The instructor (or the student, via Sage) proposes it; the student consents to that specific disclosure; the instructor sends a packet: a tailored résumé, verified certifications, a short endorsement, and the subsidy the employer can claim. The employer receives a signed link, no login, and answers with one tap: interested, not now, or hired. "Interested" offers interview times drawn from the instructor's calendar.
3. **Close the loop.** Every state change is recorded. A hire creates the verified `Application` and flows into the existing placement bridge and `SpokesRecord`, so the grant KPI and the DoHS report see it without re-entry. Retention check-ins fire at 30/60/90 days by text. The funnel (proposed → sent → viewed → interested → interviewed → hired → retained) becomes the program's placement dashboard.

The unit of value is a *Connection*, not an application. The instructor is the sender of record. Sage is the instructor's assistant and the student's guide, never the party that contacts an employer.

## 3. What exists and what is missing (from the 2026-09-05 code map)

| Need | Exists | Missing |
|---|---|---|
| Postings | 12 adapters, `JobListing`, `recommendation.ts` scorer (location 40 / cluster 40 / RIASEC 20 / skills 20 / interactions / source trust), banded results, `tailor_application` → `ResumeVersion` + `CoverLetter` | Scorer never runs against curated `Opportunity`; `ResumeVersion`/`CoverLetter` bind to `JobListing` only |
| Employers | `Opportunity.company` and `SpokesRecord.employerName` as free text | Any employer entity, contact, relationship owner, hiring history, subsidy eligibility |
| Student side of the match | Résumé (JSON), verified certifications, `CareerDiscovery` (clusters, RIASEC, transferable skills), class region, `SpokesRecord.county` | Availability, transport mode, home ZIP, pay floor, shift and childcare constraints, start date. `Student` has none of these; barriers exist only as staff-typed strings |
| Sharing with a third party | `ConsentRecord` (one scope: `cloud_file_processing`), paper release-of-information packet, `SageOperation` + `AuditLog` ledgers | A consent scope for employer referral, a recipient model, a share ledger, any outbound channel to an employer |
| Employer response | Public slug page pattern (`credentials/[slug]`), hashed single-use token pattern (`PasswordResetToken`), presigned S3 GET | A token-gated response page; any external-party attendee on `Appointment` |
| Follow-up | Twilio `sendSms`, notification preferences, appointment reminders (email only) | SMS consent record, outbound log, quiet hours, per-recipient rate limit |
| Outcomes | `Application` with verification, placement bridge (flag-gated, off by default), `SpokesRecord` placement fields + follow-ups, grant KPI report | Per-application verify button (API exists, no UI), pathway-outcomes report (script only), a funnel view |

## 4. Data model

New models live in the `visionquest` schema with RLS in the repo's established patterns (student-own rows; staff via `managed_student_ids()`; admin client only through bounded helpers).

**`Employer`** — `id, name, legalName?, sector?, clusters String[] (SPOKES cluster ids), county, city, zip?, website?, notes?, relationshipOwnerId → Student(teacher), hiredSpokesGradBefore Boolean, lastHiredAt?, subsidyFlags Json ({eip, esp, ojt, wotc, bonding} as known/unknown), status (active|paused|do_not_contact), createdAt, updatedAt`. Backfilled once from distinct `Opportunity.company` + `SpokesRecord.employerName` strings.

**`EmployerContact`** — `id, employerId, name, role?, email?, phone?, preferredChannel (email|phone|sms), contactConsentAt? (they agreed to receive packets), doNotContactAt?, createdAt`.

**`JobLead`** — the employer-linked opening. `id, employerId, contactId?, title, description?, requirements Json (mustHaveCerts[], niceToHave[], physical[], licenses[]), schedule Json (shifts: day|evening|night|weekend, hoursPerWeek range, startDate?), payMin?, payMax?, payPeriod, location, transitNotes?, clusters String[], source (manual|opportunity|joblisting|joborder), sourceRef? (Opportunity.id or JobListing.id), status (open|filled|paused|closed), openings Int default 1, postedAt, closesAt?, createdById`. The existing `Opportunity` table becomes a thin view over `JobLead` (source=opportunity) in Phase 3, then is retired.

**`StudentWorkProfile`** — student-owned, one per student. `studentId (pk), availability Json (7 days × {morning, afternoon, evening, overnight}), transport (car|ride|bus|walk|none), homeZip?, county?, maxCommuteMinutes?, payFloorHourly?, childcareHours Json?, earliestStart?, shiftLimits Json?, updatedAt, updatedVia (student|sage|teacher)`. Collected by a five-question Sage conversation or a form; editable by the student; visible to their instructor. Not shared with employers except the fields the student approves in a packet (availability and start date only).

**`Connection`** — `id, studentId, jobLeadId, employerId, proposedById (teacher or student), proposedVia (teacher|sage|student), status, statusChangedAt, consentRecordId → ConsentRecord, packet Json (resumeVersionId, coverLetterId, endorsement text, includedCertIds[], includedFields[]), sentById?, sentAt?, employerTokenHash?, tokenExpiresAt?, employerViewedAt?, employerRespondedAt?, employerResponse (interested|not_now|hired)?, responseReason?, interviewAppointmentId?, hiredAt?, startDate?, hourlyWage?, applicationId? → Application, closedReason?, createdAt, updatedAt`. Unique `[studentId, jobLeadId]`.

Status pipeline: `proposed → student_approved → sent → viewed → interested | not_now → interview_scheduled → offered → hired → started → retained_30 → retained_60 → retained_90`, with `withdrawn` (student) and `closed` (instructor) reachable from any state. Every transition writes a `ConnectionEvent` row (`connectionId, fromStatus, toStatus, actorType, actorId?, note?, at`) and a `SageOperation` when Sage is the actor.

**`ConsentRecord`** gains scope `employer_referral` (blanket permission to be introduced, revocable) and the per-Connection approval is its own event with the packet's field list frozen in `Connection.packet` — informed consent per disclosure, matching the July design's governance rule.

**`OutboundMessage`** — `id, channel (sms|email), toKind (student|employer_contact|staff), toId, templateKey, body, sentAt, providerId?, status, connectionId?` — the audit trail the SMS layer lacks today. SMS additionally needs `smsConsentAt` on `NotificationPreference` and quiet hours (no sends 21:00–08:00 local).

## 5. Matching

`src/lib/connect/matching.ts` is one function with two callers:

```
fit(student, lead) → { score 0–100, hardBlocks[], reasons[] }
rankLeadsForStudent(studentId)    // student view, Sage search_jobs
rankStudentsForLead(jobLeadId)    // job developer console, reverse match
```

Hard blocks (any one → not shown as a match, shown to the instructor with the reason): availability has zero overlap with the lead's shifts; `mustHaveCerts` not verified; pay below the student's floor; transport infeasible (no car/ride and no transit note and distance > walking); lead closed; employer `do_not_contact`; student has withdrawn from this employer before.

Soft score reuses the existing sub-scorers (`scoreLocation`, `scoreCluster`, `scoreRiasec`, `scoreSkills`, `scoreSourceTrust`) and adds: verified-cert bonus, availability overlap ratio, employer `hiredSpokesGradBefore`, pay above floor. Reasons are rendered in words at grade 6 ("Day shift. Bus 4 stops. $15/hr. Needs the forklift card you earned in May.").

Scores never leave the staff and student surfaces. The employer page shows the packet and the subsidy, not a number. This is deliberate: employer-facing AI ranking is the shape under litigation (Mobley v. Workday), and it is the kind of thing this program's employers would rightly distrust.

## 6. The Connection flow

1. **Propose.** Instructor picks a student on a lead's reverse-match list, or a student asks Sage ("I want the Production Associate one"). `propose_connection` is a `mutate_consequential` tool behind `confirmationGate`.
2. **Student approves.** The student sees one card: the employer, the job in plain language, exactly what will be sent (résumé version, which certs, availability and start date, the endorsement text), and one button. Approval writes the `employer_referral` consent if absent and freezes the packet. Without this tap nothing is sent. Sage never approves on the student's behalf.
3. **Instructor sends.** The job developer console shows the assembled packet, the subsidy line ("This hire qualifies for WV Works EIP: 50% of wages for the first 300 hours. Contact: <case manager>"), and a Send button. Sending creates the employer token (hashed, 14-day expiry, single employer contact), emails the contact, and logs an `OutboundMessage`. Sender of record is the instructor's name and program email.
4. **Employer responds.** `/connect/[token]` renders the packet (PDF via presigned GET, plus a summary), the subsidy explainer, and three actions. *Interested* shows the instructor's open slots (`AdvisorAvailability`) and books an `Appointment` with a new `externalAttendee` field. *Not now* asks one optional reason. *Hired* asks start date and wage. Every view and action is logged with the token, never with the student's id in the URL.
5. **Follow up.** No view in 3 days → instructor nudge; no response in 7 → instructor re-send prompt; interested → student text "Interview Tue 10am at X. Reply Y to confirm"; hired → `Application` created with `verificationStatus: verified`, `Connection.applicationId` set, placement bridge fires, SPOKES form prefilled; 30/60/90 → student text check-in, answer writes `SpokesEmploymentFollowUp`.
6. **Report.** `/teacher/connect` shows the funnel per class and per employer; the grant KPI report reads placements as it does today; the DoHS-facing export (fields to be confirmed by WVDE, memo ask #1) is generated from `Connection` + `SpokesRecord`.

## 7. What the student sees

One card at a time. "Ms. Legg wants to send your résumé to Mountain Metal for a Production Associate job. Day shift, $15 an hour, on the Route 4 bus. She will also tell them about your forklift card. OK to send?" Then: "Sent Tuesday." Then: "They want to meet you. Pick a time." Every screen at grade 6, one action, read-aloud available. The student can withdraw at any time and see everything ever shared about them in the existing `/memory` page, which gains a "Shared with employers" section.

## 8. What the instructor sees

`/teacher/connect`: a board of open leads with "who fits" counts; a board of students with "best leads" counts; the pipeline; follow-ups due today; employer directory with relationship history; a "Batch to WorkForce WV" action that packages this week's ready graduates for the Business Services Rep. Adding a lead from an NLx posting, a MACC job order, or a phone call is one form. Every send, every response, every hire is in the ledger.

## 9. Sage's role

- `search_jobs` (read): top three leads or postings for this student, with reasons; fed by `rankLeadsForStudent` and the existing `JobListing` pool.
- `explain_job` (read): grade-6 rewrite of a lead or posting in a fixed template (What you'd do / Hours / Pay / Must-haves / How you'd get there), readability-gated.
- `propose_connection` (write, confirm-card): student-initiated proposal; lands on the instructor's board as `proposed`.
- `connection_status` (read): where each of the student's connections stands, in words.
- Instructor-side: draft the endorsement paragraph from verified facts only (certs, attendance, instructor notes), on the local model, never fabricating; draft the subsidy line from the employer's flags and the WV rule table.

## 10. Guardrails (non-negotiable)

- No auto-apply, no headless submission, no scraping of boards or employer sites.
- No employer-facing score, ranking, or comparison between candidates.
- No student data leaves the program without a per-disclosure approval; the packet's field list is frozen and shown to the student before it goes.
- Student record text (résumé, endorsement inputs) is processed on the local provider per the FERPA routing policy; the employer email contains no PII beyond the packet the student approved.
- Employer contact is rate-limited (default: three packets per employer per week) and honours `do_not_contact`.
- SMS requires recorded consent, respects quiet hours, is logged, and every message names SPOKES.
- The instructor is always the sender; Sage proposes and drafts, humans send.

## 11. Metrics

Per class and per employer: connections proposed, student-approved, sent, viewed, interested, interviewed, hired, started, retained 30/60/90; days from send to response and to hire; subsidy attached vs not; comparison against self-directed applications from the board. The success metric for the program is verified placements per enrolled student and 90-day retention, which is what DoHS and the grant KPI already measure.

## 12. Open decisions for Britt

1. **Employer packet contents.** Recommended default: tailored résumé (PDF), verified certs list, availability and earliest start, endorsement paragraph, subsidy line. Not included by default: contact details beyond what the résumé carries, benefits status, any narrative about barriers.
2. **Who may send.** Recommended: instructors and the Job Coach; students propose but do not send; Sage never sends.
3. **Consent instrument.** Whether the digital `employer_referral` consent is enough, or whether WVDE requires the paper release-of-information packet to be on file first. Ask Sandra Adkins.
4. **Employer response page branding.** Program name and instructor identity are visible to the employer; confirm the program is comfortable with a public page under the VisionQuest domain.
5. **Retire `Opportunity` or keep it.** Recommended: migrate to `JobLead` in Phase 3 and retire, so there is one board and one tracker (closes VQ-R-017).
