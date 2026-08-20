---
name: student-data-privacy
description: FERPA-sensitive handling of TANF/SNAP student PII in VisionQuest — RLS scoping, staff-read auditing, no PII in logs, local-only AI routing for student_record data. Use when touching student data, logging, or AI provider routing.
---
# Student Data Privacy Skill

Automatically invoked when handling PII, student records, or data export/sharing features.

## Context
VisionQuest serves adults on TANF/SNAP through the SPOKES workforce development program.
These students are in vulnerable situations — their data handling must be treated with the same
care as healthcare or financial records.

## PII Fields in This System
- Student: name, email, passwordHash, securityQuestionAnswers
- SpokesRecord: firstName, lastName, county, barriers, wage, referralEmail
- CaseNote: free-text body may contain sensitive details
- ChatMessages: students may disclose personal circumstances to Sage
- FileUploads: may contain ID documents, certificates, resumes with addresses

## Data Access Rules
1. Students can only see their own data — every query must filter by `studentId`
2. Teachers can see data for students in their classes — scope by class enrollment
3. Admin access is separate and audited
4. Public credential pages are opt-in — student explicitly publishes
5. Case notes visibility defaults to `teacher` — never shown to other students

## API Response Sanitization
- Never return `passwordHash`, `securityQuestionAnswers`, or `sessionVersion` in API responses
- Use Prisma `select` to explicitly pick returned fields — never return full model objects
- Error messages must not leak internal state (e.g., "user not found" vs "invalid credentials")

## Logging & Monitoring
- Sentry: configured to scrub PII fields before sending error reports
- AuditLog: records actor, action, target — but NOT the full data payload
- Server logs: no student identifier at any log level. Names and emails are the obvious cases, and `studentId` counts too, because it resolves to exactly one student's record for anyone who can also read the database. Log the staff `actorId`, the surface, and the error message instead
- The failure path of `recordStudentView` in `src/lib/audit.ts` is the reference shape, and `src/lib/audit.test.ts` shows how to assert a log payload carries no student id
- When a failure needs a per-student key to be debuggable, log `studentLogKey(id)` from `src/lib/log-keys.ts`. It is a one-way sha256 prefix (`stu_a1b2c3d4e5f6`): two log lines for one student correlate, and the log alone identifies nobody. Use it especially on paths that are logged *because* nothing reached the database, where the log line is the only trace
- Third-party error text quotes contact details (SMTP bounces quote the address, Twilio quotes the number), so wrap provider errors in `redactContactInfo` from `src/lib/log-redaction.ts` before logging them
- This is enforced, not advisory: the `no-restricted-syntax` rule in `eslint.config.mjs` fails CI on a student identifier inside any `logger.*` call. Fix the log line rather than disabling the rule
- Chat messages: stored in DB only, never logged to stdout or Sentry

## Data Export
- Teacher export at `/api/teacher/export` must respect class enrollment scope
- Export files must be generated server-side and served via authenticated download
- No bulk student data in client-side state — fetch per-page, per-student

## Deletion & Retention
- Student account deletion should cascade (goals, messages, files, progress)
- File uploads: delete from Supabase Storage when DB record is deleted
- No data retention policy defined yet — flag for future compliance review
