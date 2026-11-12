/**
 * Demo closeout (readiness H10): what only the database server can say.
 *
 * Every raw statement the closeout sends is in this file. Each is fixed text
 * with its values passed as parameters; the orphan probes alone add a table
 * and column name, taken from the fixed list in closeout.orphans.ts and
 * checked to be a plain word. The connection string is never
 * read here: what the server reports is the identity, because a `?host=`
 * option in a Postgres URL overrides the host written in it.
 */
import { Prisma } from "@prisma/client";
import { chunksOf, idsOf, type CloseoutTx, type Ids, type Row } from "./closeout.core";

/**
 * DEMO_STUDENT_CREATE_LOCK in create-student.ts, also taken by reset.ts. While
 * this transaction holds it, no demo student can be created.
 */
const DEMO_STUDENT_CREATE_LOCK = 2_610_190_001;

/** Which database a run is talking to, as the server reports it. */
export interface CloseoutTarget {
  readonly database: string;
  /** Null when the server does not report one, as on a local socket. */
  readonly serverAddress: string | null;
}

export interface ServerFacts {
  readonly target: CloseoutTarget;
  /** The server's clock at the start of the transaction. */
  readonly now: Date;
  /** True for a superuser or a role with BYPASSRLS: no policy hides a row from it. */
  readonly seesEveryRow: boolean;
  /** Every migration the ledger lists as applied, sorted, or null when there is no ledger. */
  readonly appliedMigrations: readonly string[] | null;
}

function rowsOf(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return result.filter((row): row is Row => typeof row === "object" && row !== null);
}

function firstValue(result: unknown, column: string): unknown {
  return rowsOf(result)[0]?.[column];
}

/**
 * Must be the first statement of every transaction. With row security off,
 * Postgres refuses a statement that a policy would filter instead of quietly
 * leaving rows out, so a count can never be short without an error. SET takes
 * no snapshot, so it does not fix what the transaction sees.
 */
export async function refuseFilteredReads(tx: CloseoutTx): Promise<void> {
  await tx.$executeRaw`SET LOCAL row_security = off`;
}

/**
 * Takes the demo student create lock without waiting, and says whether it got
 * it. It never waits: a serializable transaction sees the database as it was
 * when its first query began, so a lock that waited would be held over a view
 * that is already out of date. Not getting it means a demo account is being
 * created or reset right now, and the caller refuses.
 */
export async function tryCreateLock(tx: CloseoutTx): Promise<boolean> {
  const result = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${DEMO_STUDENT_CREATE_LOCK}::bigint) AS locked`;
  return firstValue(result, "locked") === true;
}

/**
 * Every migration the ledger lists as finished and not rolled back. Prisma
 * keeps the ledger in the first schema the datasource lists (visionquest
 * here); an older setup has it in public. Null when there is no ledger.
 */
async function appliedMigrations(tx: CloseoutTx): Promise<string[] | null> {
  const found = await tx.$queryRaw`SELECT to_regclass('visionquest._prisma_migrations') IS NOT NULL AS in_app_schema, to_regclass('public._prisma_migrations') IS NOT NULL AS in_public`;
  let rows: unknown;
  if (firstValue(found, "in_app_schema") === true) {
    rows = await tx.$queryRaw`SELECT DISTINCT migration_name AS name FROM visionquest."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  } else if (firstValue(found, "in_public") === true) {
    rows = await tx.$queryRaw`SELECT DISTINCT migration_name AS name FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  } else {
    return null;
  }
  return idsOf(rowsOf(rows), "name").sort();
}

/** Asks the server which database this is, what time it is, what the role may see and how far it is migrated. */
export async function readServerFacts(tx: CloseoutTx): Promise<ServerFacts> {
  const identity = await tx.$queryRaw`SELECT current_database() AS database, host(inet_server_addr()) AS address, now() AS now`;
  const database = firstValue(identity, "database");
  const address = firstValue(identity, "address");
  const now = firstValue(identity, "now");
  if (typeof database !== "string" || !(now instanceof Date)) throw new Error("The database server did not say which database this is.");
  const role = await tx.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  return {
    target: { database, serverAddress: typeof address === "string" ? address : null },
    now,
    seesEveryRow: firstValue(role, "rolsuper") === true || firstValue(role, "rolbypassrls") === true,
    appliedMigrations: await appliedMigrations(tx),
  };
}

/**
 * The payload keys that name a row the closeout deletes: a student (most
 * jobs), a class, a class's scrape config and run (`scrape_jobs`, from
 * src/app/api/teacher/jobs/refresh/route.ts) and a wager (`wager_diagnosis`).
 */
export type JobPayloadKey = "studentId" | "classId" | "configId" | "scrapeRunId" | "wagerId";

/**
 * Queued and finished jobs whose payload holds one of these ids under `key`.
 * The payload is JSON text written by `enqueueJob` (src/lib/jobs.ts), which has
 * no foreign key, so the schema would leave every one of these rows behind.
 * Text that does not start with `{` is skipped. pg_input_is_valid would also
 * skip broken JSON that does, but it needs Postgres 16 and production is not
 * known to be on it; JSON.stringify never writes broken JSON, and if a row did
 * hold it the statement would fail and the closeout would stop, not delete.
 */
export async function jobIdsNaming(tx: CloseoutTx, key: JobPayloadKey, ids: Ids, chunkSize: number): Promise<string[]> {
  const found: string[] = [];
  for (const chunk of chunksOf(ids, chunkSize)) {
    const result = await tx.$queryRaw`SELECT id FROM visionquest."BackgroundJob" WHERE (CASE WHEN left(payload, 1) = '{' THEN payload::jsonb->>(${key}::text) END) IN (${Prisma.join(chunk)})`;
    found.push(...idsOf(rowsOf(result), "id"));
  }
  return found;
}

/**
 * One account or class column with no foreign key. `only` limits the probe to
 * rows whose kind column says the id is of the parent's kind.
 */
export interface OrphanProbe {
  readonly model: Prisma.ModelName;
  readonly column: string;
  readonly parent: "Student" | "SpokesClass";
  readonly only?: { readonly column: string; readonly values: readonly string[] };
}

/** Table and column names go into the statement as text, so each must be a plain word from ORPHAN_PROBES. */
const IDENTIFIER = /^[A-Za-z]+$/;

function quoted(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) throw new Error("A closeout probe names a table or column that is not a plain word.");
  return Prisma.raw(`"${name}"`);
}

function countIn(result: unknown): number {
  const value = firstValue(result, "orphans");
  return typeof value === "number" ? value : Number(value ?? 0);
}

/**
 * Values production writes in an account column that are not account ids, so
 * no missing account. Each is the actor of something no person did:
 *   - `admin-key`: a staff promotion made with the shared ADMIN_KEY
 *     (ADMIN_KEY_ACTOR, src/lib/promote-staff-account.ts).
 *   - `deterministic`: a wager verdict a rule resolved (src/lib/sage/wagers.ts).
 *   - `system`: the actor of jobs.
 *   - `demo-closed`: written by the closeout itself in place of a deleted demo
 *     account, on audit rows about shared content (CLOSED_DEMO_ACTOR in
 *     closeout.shared-content.ts, which a test pins to this list).
 * And every value that starts with SENTINEL_PREFIX, such as
 * `system:sage-autopilot` (src/lib/sage/briefing.ts). The colon is part of the
 * prefix, so an id that merely starts with the letters "system" still counts.
 */
export const SENTINEL_ACTORS: readonly string[] = ["admin-key", "deterministic", "system", "demo-closed"];
export const SENTINEL_PREFIX = "system:";

/**
 * Rows of one probe whose id names no row of its parent, sentinel actors left
 * out. Names come from ORPHAN_PROBES only; every value is a parameter.
 */
export async function countOrphans(tx: CloseoutTx, probe: OrphanProbe): Promise<number> {
  const table = quoted(probe.model);
  const column = quoted(probe.column);
  const kind = probe.only ? Prisma.sql`AND t.${quoted(probe.only.column)} IN (${Prisma.join([...probe.only.values])})` : Prisma.empty;
  const notSentinel = Prisma.sql`t.${column} NOT IN (${Prisma.join([...SENTINEL_ACTORS])}) AND left(t.${column}, ${SENTINEL_PREFIX.length}) <> ${SENTINEL_PREFIX}`;
  const query = Prisma.sql`SELECT count(*)::int AS orphans FROM visionquest.${table} t WHERE t.${column} IS NOT NULL AND ${notSentinel} ${kind} AND NOT EXISTS (SELECT 1 FROM visionquest.${quoted(probe.parent)} p WHERE p.id = t.${column})`;
  return countIn(await tx.$queryRaw(query));
}

/**
 * Notices to staff with no demo mark whose title or text holds the display
 * name of one of these accounts. Ids are collected so a notice that names two
 * accounts in different batches is counted once.
 */
export async function noticesNaming(tx: CloseoutTx, accountIds: Ids, chunkSize: number): Promise<number> {
  const found = new Set<string>();
  for (const chunk of chunksOf(accountIds, chunkSize)) {
    const result = await tx.$queryRaw`SELECT n.id FROM visionquest."Notification" n JOIN visionquest."Student" r ON r.id = n."studentId" WHERE r."demoAccount" IS NULL AND r.role <> 'student' AND EXISTS (SELECT 1 FROM visionquest."Student" d WHERE d.id IN (${Prisma.join(chunk)}) AND length(d."displayName") > 0 AND (strpos(n.title, d."displayName") > 0 OR strpos(coalesce(n.body, ''), d."displayName") > 0))`;
    idsOf(rowsOf(result), "id").forEach((id) => found.add(id));
  }
  return found.size;
}
