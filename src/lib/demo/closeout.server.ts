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
  /** The newest migration the ledger lists as applied, or null when there is no ledger or no row. */
  readonly newestMigration: string | null;
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
 * The newest applied migration by name. Prisma keeps the ledger in the first
 * schema the datasource lists (visionquest here); an older setup has it in
 * public. Byte order, so it sorts the way the folder names do.
 */
async function newestAppliedMigration(tx: CloseoutTx): Promise<string | null> {
  const found = await tx.$queryRaw`SELECT to_regclass('visionquest._prisma_migrations') IS NOT NULL AS in_app_schema, to_regclass('public._prisma_migrations') IS NOT NULL AS in_public`;
  let newest: unknown = null;
  if (firstValue(found, "in_app_schema") === true) {
    newest = firstValue(await tx.$queryRaw`SELECT max(migration_name COLLATE "C") AS newest FROM visionquest."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`, "newest");
  } else if (firstValue(found, "in_public") === true) {
    newest = firstValue(await tx.$queryRaw`SELECT max(migration_name COLLATE "C") AS newest FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`, "newest");
  }
  return typeof newest === "string" ? newest : null;
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
    newestMigration: await newestAppliedMigration(tx),
  };
}

/**
 * Queued and finished jobs whose payload names one of these accounts. The
 * payload is JSON text written by `enqueueJob` (src/lib/jobs.ts), which has no
 * foreign key, so the schema would leave every one of these rows behind.
 */
export async function jobIdsNaming(tx: CloseoutTx, accountIds: Ids, chunkSize: number): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of chunksOf(accountIds, chunkSize)) {
    const result = await tx.$queryRaw`SELECT id FROM visionquest."BackgroundJob" WHERE (CASE WHEN left(payload, 1) = '{' THEN payload::jsonb->>'studentId' END) IN (${Prisma.join(chunk)})`;
    ids.push(...idsOf(rowsOf(result), "id"));
  }
  return ids;
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
 * Rows of one probe whose id names no row of its parent. The literal `system`
 * is the actor of jobs and is not an id. Names come from ORPHAN_PROBES only;
 * every value is a parameter.
 */
export async function countOrphans(tx: CloseoutTx, probe: OrphanProbe): Promise<number> {
  const table = quoted(probe.model);
  const column = quoted(probe.column);
  const kind = probe.only ? Prisma.sql`AND t.${quoted(probe.only.column)} IN (${Prisma.join([...probe.only.values])})` : Prisma.empty;
  const query = Prisma.sql`SELECT count(*)::int AS orphans FROM visionquest.${table} t WHERE t.${column} IS NOT NULL AND t.${column} <> 'system' ${kind} AND NOT EXISTS (SELECT 1 FROM visionquest.${quoted(probe.parent)} p WHERE p.id = t.${column})`;
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
