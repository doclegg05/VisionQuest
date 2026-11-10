/**
 * Demo closeout (readiness H10): the small pieces every closeout file shares.
 * The database as the tool sees it, the plan, and how ids are sent in batches.
 * Nothing here knows which tables the closeout deletes from: closeout.ts does.
 */

import type { Prisma } from "@prisma/client";

export type Where = Readonly<Record<string, unknown>>;
export type Ids = readonly string[];
export type DemoEnv = Readonly<Record<string, string | undefined>>;
export type Row = Readonly<Record<string, unknown>>;

/** The four calls this tool makes on a table. */
export interface CloseoutTable {
  count(args: { where?: Where }): Promise<number>;
  deleteMany(args: { where: Where }): Promise<{ count: number }>;
  findMany(args: { where: Where; select: Readonly<Record<string, true>> }): Promise<ReadonlyArray<Row>>;
  create(args: { data: Row }): Promise<unknown>;
}

export interface CloseoutTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  /** A tagged template, or a statement built with Prisma.sql from fixed text and parameters. */
  $queryRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<unknown>;
}

export interface CloseoutClient {
  $transaction<T>(
    run: (tx: CloseoutTx) => Promise<T>,
    options?: { isolationLevel?: "Serializable"; maxWait?: number; timeout?: number },
  ): Promise<T>;
}

function isCloseoutTable(value: unknown): value is CloseoutTable {
  if (typeof value !== "object" || value === null) return false;
  return ["count", "deleteMany", "findMany", "create"].every((name) => typeof Reflect.get(value, name) === "function");
}

/** The table for a model name, as Prisma exposes it on a client or a transaction. */
export function tableOf(tx: object, model: string): CloseoutTable {
  const candidate: unknown = Reflect.get(tx, model.charAt(0).toLowerCase() + model.slice(1));
  if (!isCloseoutTable(candidate)) throw new Error(`The database client has no table for the model ${model}`);
  return candidate;
}

/**
 * What one run deletes: accounts (Student rows), classes (SpokesClass rows) and
 * queued jobs (BackgroundJob rows whose payload names one of the accounts).
 */
export interface CloseoutPlan {
  readonly accountIds: Ids;
  readonly classIds: Ids;
  readonly jobIds: Ids;
}

/** One run: the transaction, what it deletes, the batch size and the server's clock. */
export interface Run {
  readonly tx: CloseoutTx;
  readonly plan: CloseoutPlan;
  readonly chunk: number;
  /** The database server's time when the transaction began. Never this computer's clock. */
  readonly now: Date;
}

export const UNMARKED = { demoAccount: null } as const;

/** One removal: a model, the ids it is given, and how a row is matched. */
export interface DeleteStep {
  readonly model: Prisma.ModelName;
  /** Which ids the step is given: the plan's accounts, its classes or its queued jobs. */
  readonly scope: "account" | "class" | "job";
  /** The column that holds the id, or null for a row reached through its parent. */
  readonly column: string | null;
  readonly where: (ids: Ids) => Where;
}

export function idsFor(run: Run, scope: DeleteStep["scope"]): Ids {
  if (scope === "account") return run.plan.accountIds;
  return scope === "class" ? run.plan.classIds : run.plan.jobIds;
}

/** The distinct values of `column` over every row these steps would delete. */
export async function plannedValues(run: Run, steps: readonly DeleteStep[], column: string): Promise<Set<string>> {
  const found = new Set<string>();
  for (const step of steps) {
    for (const chunk of chunksOf(idsFor(run, step.scope), run.chunk)) {
      const rows = await tableOf(run.tx, step.model).findMany({ where: step.where(chunk), select: { [column]: true } });
      idsOf(rows, column).forEach((value) => found.add(value));
    }
  }
  return found;
}

export const inList = (column: string) => (ids: Ids): Where => ({ [column]: { in: ids } });

/** The text values of one column, leaving out rows where it is empty or not text. */
export function idsOf(rows: ReadonlyArray<Row>, column: string): string[] {
  return rows.flatMap((row) => {
    const value = row[column];
    return typeof value === "string" ? [value] : [];
  });
}

export function chunksOf(ids: Ids, size: number): Ids[] {
  const chunks: Ids[] = [];
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size));
  return chunks;
}

/** Rows of `model` that match `where` for any of the ids, sent to the database in batches. */
export async function countIn(run: Run, model: string, where: (ids: Ids) => Where, ids: Ids): Promise<number> {
  let total = 0;
  for (const chunk of chunksOf(ids, run.chunk)) total += await tableOf(run.tx, model).count({ where: where(chunk) });
  return total;
}

/** One column of the rows that hold any of the ids in `column`, batch by batch. */
export async function valuesWhere(run: Run, model: string, column: string, select: string, ids: Ids): Promise<string[]> {
  const found: string[] = [];
  for (const chunk of chunksOf(ids, run.chunk)) {
    found.push(...idsOf(await tableOf(run.tx, model).findMany({ where: { [column]: { in: chunk } }, select: { [select]: true } }), select));
  }
  return found;
}
