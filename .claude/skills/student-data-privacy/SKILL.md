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
- Server logs: no PII at any log level — use student IDs, never names/emails
- Chat messages: stored in DB only, never logged to stdout or Sentry

## Data Export
- Teacher export at `/api/teacher/export` must respect class enrollment scope
- Export files must be generated server-side and served via authenticated download
- No bulk student data in client-side state — fetch per-page, per-student

## Deletion & Retention
- Student account deletion should cascade (goals, messages, files, progress)
- File uploads: delete from Supabase Storage when DB record is deleted
- No data retention policy defined yet — flag for future compliance review
