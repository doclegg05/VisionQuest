# Incident basics

Approved by Britt in this thread on 2026-11-12 (launch gate H8). This is an operating procedure,
not evidence that alert delivery, backups or a restore have been verified.

## Who acts

The instructor tells the program admin when students cannot sign in, save work,
open required documents or use Sage. The program admin owns the incident and
contacts the deployment operator (Britt). Record who is handling it and the next
update time in the program's existing staff communication channel. Do not put a
student name, chat, benefit record, password or connection string in a ticket.

The Sage uptime workflow checks `/api/health` every five minutes. GitHub may delay
scheduled runs; this is not a guaranteed five-minute response service. The server
also raises `sage_disconnected` through the existing alarm reporter after five
minutes of observed disconnection, once per outage. Sentry delivery and recipient
configuration still require the O-6 owner check. Before real students start,
Britt must confirm someone receives an actual test alert. Staff reports remain
the fallback when monitoring or the app is unavailable.

## First five minutes

1. Note the time, affected screen, whether one person or the whole class is
   affected, the deployed commit and the last known good commit. Use fictional
   accounts for reproduction.
2. Open `/api/health`. A non-200 response means app/database health failed. A 200
   response with `sage.connected: false` means the rest of the app may still work.
   The Sage flag checks connection/model discovery, not answer quality or capacity.
3. Check Render's deploy status and redacted logs, the uptime workflow, and Sentry.
   Follow [deployment guidance](../../DEPLOY.md) for the trusted client-address
   check if a whole classroom is being rate limited. Do not disable limits or RLS.
4. Tell the instructor what still works and when the next update will arrive.
   A safety concern follows the program's human safety procedure immediately;
   nobody waits for Sage or an automated alert to respond.

## What the class does

If only Sage is down, continue with dashboard tasks, learning resources and
documents. The instructor can guide goal work directly. Do not repeatedly resend
a message or signature while its first request may still be running. Confirm
the saved state before retrying. Never tell a student a failed save succeeded.

If the whole app is down, use the program's printed/offline activity and normal
attendance procedure. Keep any temporary notes in the program's approved private
location, not a public issue or an AI service. When service returns, reconcile
the notes once and verify the result before disposing of temporary copies under
the approved retention policy.

## Repair and rollback

Deploy in a window announced to instructors, preferably outside class. A merge
to `main` deploys automatically, so the operator checks the deployed SHA and
health afterward. Do not merge an unrelated change during an incident.

For a regression after deploy, the operator can redeploy the last known good
Render build using [DEPLOY.md](../../DEPLOY.md). Check migration history first:
rolling back code does not undo a database migration. Never reset the database,
rename an applied migration, purge demo rows or restore over live records as a
routine rollback. A database restore follows the separate
[backup and restore runbook](backup-restore.md), with a verified backup and
explicit authorization for any destructive action. Storage objects and database
rows have separate recovery requirements.

For a Sage-only outage, check the Mac host and relay connection. Restart only
the component identified as unhealthy. Keep the local-only AI block enabled;
switching student traffic to a cloud provider is not an incident workaround.

## Before closing

- Verify the deployed SHA and healthy database and Sage connection flags.
- With a fictional account, test sign-in, one save and read-back, opening a
  required document, and a Sage message and Stop. Verify any affected staff path.
- Confirm the classroom can resume and that queued/deferred work has recovered.
- Record the cause, fix, affected interval and any follow-up using counts and
  redacted information. Privacy concerns follow the program's escalation process.

## Logs and retention

Use redacted app/Sentry records and access-controlled CI artifacts. Do not export
student data into debugging tools. This runbook sets no new retention duration:
the [retention policy](../DATA_RETENTION_POLICY.md), configuration and unresolved
owner decisions remain authoritative. The operator confirms provider-side log
retention and access before real students start. Preserve relevant evidence under
the approved incident procedure; do not delete audit rows to clear an alert.
