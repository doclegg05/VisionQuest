-- Advisor double-booking guard (2026-09-01 review F27 / API-U-02).
-- POST /api/appointments/book read the open slots, then inserted; two
-- students racing for one slot both passed the read. This partial unique
-- index makes the database the arbiter: at most one 'scheduled' row may
-- exist per (advisorId, startsAt). Cancelled, completed, and missed rows
-- stay out of the index, so a freed slot can be booked again. The app maps
-- the losing insert (Prisma P2002) to a 409 in src/lib/appointment-booking.ts.
--
-- Hand-written, not generated. Prisma's schema language cannot express a
-- partial index, so prisma/schema.prisma keeps the plain
-- @@index([advisorId, startsAt]) and this index exists only here.
-- Drift: none is reported. The schema engine's Postgres describer filters
-- indexes with `indpred IS NULL` (it ignores partial indexes), so
-- `prisma migrate dev` and `prisma migrate diff` neither see this index nor
-- propose dropping it. The comment on the Appointment model is the only
-- pointer from the schema; a plain @@unique there would block re-booking a
-- cancelled slot and must not be added.
--
-- Locking: plain CREATE UNIQUE INDEX. CONCURRENTLY cannot run inside the
-- transaction Prisma wraps each migration in. The build holds a SHARE lock
-- on Appointment: reads continue, writes wait until it finishes. The table
-- is small (one program's appointments), so the build takes milliseconds
-- and a booking that lands during it waits rather than fails.
--
-- Duplicate guard: the index build fails if two 'scheduled' rows already
-- share a slot, which would leave the deploy stuck on a failed migration
-- against the only database. Instead of failing, resolve deterministically
-- first: keep the earliest-created booking per slot (ties broken by id) and
-- mark the rest 'cancelled' with a note that says why. Rows are kept, not
-- deleted. The count is raised as a NOTICE for the Postgres server log;
-- Prisma's CLI does not print server notices, so the note on each affected
-- row is the trail a teacher or operator can actually see. CI applies this
-- to an empty table (0 rows touched); production has had no way to know
-- until it runs.

DO $$
DECLARE
  cancelled_duplicates integer;
BEGIN
  WITH ranked AS (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "advisorId", "startsAt"
             ORDER BY "createdAt", "id"
           ) AS position
    FROM "visionquest"."Appointment"
    WHERE "status" = 'scheduled'
  )
  UPDATE "visionquest"."Appointment" AS appointment
  SET "status" = 'cancelled',
      "notes" = concat_ws(
        E'\n\n',
        appointment."notes",
        'This time was booked twice with the same advisor. The earlier booking was kept. Please pick another time.'
      ),
      "updatedAt" = now()
  FROM ranked
  WHERE ranked."id" = appointment."id"
    AND ranked.position > 1;

  GET DIAGNOSTICS cancelled_duplicates = ROW_COUNT;
  RAISE NOTICE 'Appointment slot guard: cancelled % duplicate scheduled booking(s) before creating the unique index', cancelled_duplicates;
END $$;

CREATE UNIQUE INDEX "Appointment_advisorId_startsAt_scheduled_key"
  ON "visionquest"."Appointment"("advisorId", "startsAt")
  WHERE "status" = 'scheduled';
