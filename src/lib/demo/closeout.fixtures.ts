/**
 * Test support for the demo closeout (readiness H10). Not imported by the app.
 *
 * Two things live here, and both read the schema from Prisma's DMMF so they
 * cannot drift from prisma/schema.prisma:
 *
 *   - `FakeDb`, an in-memory database that the unit tests run the closeout
 *     against. It refuses a field or relation the schema does not have, and it
 *     applies each foreign key's delete rule (cascade, set null, restrict), so
 *     an explicit delete in the wrong order fails here as it would in Postgres.
 *   - `seedUniverse`, which writes one student, one teacher, one class and a
 *     row in every model that hangs off them. The unit tests seed the fake
 *     with it and closeout.db.test.ts seeds Postgres with it.
 */
import { Prisma } from "@prisma/client";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN } from "./config";

export type Row = Readonly<Record<string, unknown>>;
type Field = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;
type DeleteRule = "Cascade" | "SetNull" | "Restrict";

export const MODELS: readonly Model[] = Prisma.dmmf.datamodel.models;
const MODEL_BY_NAME = new Map(MODELS.map((model) => [model.name, model]));

export function modelNamed(name: string): Model {
  const model = MODEL_BY_NAME.get(name);
  if (!model) throw new Error(`The schema has no model named ${name}`);
  return model;
}

export function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** One foreign key: the child's columns, the parent's columns and the delete rule. */
export interface Edge {
  readonly child: string;
  readonly relation: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly parent: string;
  readonly required: boolean;
  readonly onDelete: DeleteRule;
}

function deleteRuleOf(field: Field): DeleteRule {
  if (field.relationOnDelete === "Cascade" || field.relationOnDelete === "SetNull") return field.relationOnDelete;
  if (field.relationOnDelete === "Restrict" || field.relationOnDelete === "NoAction") return "Restrict";
  // Prisma's default: an optional relation is set to null, a required one restricts.
  return field.isRequired ? "Restrict" : "SetNull";
}

export const EDGES: readonly Edge[] = MODELS.flatMap((model) =>
  model.fields
    .filter((field) => field.kind === "object" && (field.relationFromFields?.length ?? 0) > 0)
    .map((field) => ({
      child: model.name,
      relation: field.name,
      from: field.relationFromFields ?? [],
      to: field.relationToFields ?? [],
      parent: field.type,
      required: field.isRequired,
      onDelete: deleteRuleOf(field),
    })),
);

/** Models reachable from `root` by following foreign keys downward, root first. */
export function modelsBelow(root: string): readonly string[] {
  const seen = new Set([root]);
  let frontier = [root];
  while (frontier.length > 0) {
    const next = EDGES.filter((edge) => frontier.includes(edge.parent) && !seen.has(edge.child)).map((edge) => edge.child);
    frontier = [...new Set(next)];
    frontier.forEach((name) => seen.add(name));
  }
  return MODELS.map((model) => model.name).filter((name) => seen.has(name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return (left ?? null) === (right ?? null);
}

/** SQL comparison rules: NULL is never "in", "not in" or "not equal to" anything. */
function scalarMatches(value: unknown, condition: unknown): boolean {
  if (!isRecord(condition)) return sameValue(value, condition);
  return Object.entries(condition).every(([operator, operand]) => {
    const known = value !== null && value !== undefined;
    if (operator === "equals") return sameValue(value, operand);
    if (operator === "in") return known && Array.isArray(operand) && operand.includes(value);
    if (operator === "notIn") return known && Array.isArray(operand) && !operand.includes(value);
    if (operator === "not") return operand === null ? known : known && !scalarMatches(value, operand);
    if (operator === "startsWith") return typeof value === "string" && typeof operand === "string" && value.startsWith(operand);
    if (operator === "contains") return typeof value === "string" && typeof operand === "string" && value.includes(operand);
    if (operator === "gte") return value instanceof Date && operand instanceof Date && value.getTime() >= operand.getTime();
    throw new Error(`The fake database does not support the operator ${operator}`);
  });
}

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

interface Delegate {
  count(args?: { where?: unknown }): Promise<number>;
  deleteMany(args: { where?: unknown }): Promise<{ count: number }>;
  findMany(args: { where?: unknown; select?: Readonly<Record<string, true>> }): Promise<Row[]>;
  create(args: { data: Row }): Promise<Row>;
}

export interface FakeTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<unknown>;
  [delegate: string]: unknown;
}

export interface FakeClient {
  $transaction<T>(run: (tx: FakeTx) => Promise<T>, options?: unknown): Promise<T>;
  $disconnect(): Promise<void>;
}

/** The newest migration the fake database says it has applied, unless a test changes it. */
export const FAKE_MIGRATION = "20261101000000_fake_newest";
/** The demo student create lock, as the fake sees it in a statement's values. */
const LOCK_STATEMENT = /pg_try_advisory_xact_lock/;

/** An orphan probe from closeout.server.ts, with its table, column, kind column (if any) and parent. */
const ORPHAN_STATEMENT = /^SELECT count\(\*\)::int AS orphans FROM visionquest\."(\w+)" t WHERE t\."(\w+)" IS NOT NULL AND t\."\w+" <> 'system' (?:AND t\."(\w+)" IN \([?, ]+\) )?AND NOT EXISTS \(SELECT 1 FROM visionquest\."(\w+)" p WHERE/;

/** A statement built with Prisma.sql, as opposed to a tagged template's strings. */
function isSql(query: TemplateStringsArray | Prisma.Sql): query is Prisma.Sql {
  return !Array.isArray(query);
}

/** What a raw statement was given: plain values, and the values inside a `Prisma.join(...)`. */
function flatValues(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) => {
    const inner: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "values") : undefined;
    return Array.isArray(inner) ? inner : [value];
  });
}

function studentIdIn(payload: unknown): string | null {
  if (typeof payload !== "string" || !payload.startsWith("{")) return null;
  const parsed: unknown = JSON.parse(payload);
  const id: unknown = isRecord(parsed) ? parsed.studentId : undefined;
  return typeof id === "string" ? id : null;
}

export class FakeDb {
  private tables = new Map<string, readonly Row[]>();
  private sequence = 0;
  /** The server this fake stands in for: its name, its address and its clock. */
  database = "closeout_fake";
  serverAddress: string | null = "10.0.0.7";
  now = new Date("2026-12-19T15:00:00.000Z");
  /** A role sees every row when it is a superuser or has BYPASSRLS. Both false: row level security limits it. */
  superuser = false;
  bypassesRls = true;
  /** The schema that holds Prisma's migration ledger, and the migrations it lists as applied. */
  ledgerSchema: "visionquest" | "public" | null = "visionquest";
  appliedMigrations: readonly string[] = [FAKE_MIGRATION];
  /** True while some other transaction holds the demo student create lock. */
  createLockHeld = false;
  /** Name a model to make the next delete from it throw, as a lost connection would. */
  failOnDeleteOf: string | null = null;
  /** What that delete throws. An object with a `code` stands in for a Prisma error. */
  failure: unknown = null;
  /** Thrown after the callback has finished and its changes are kept: a connection lost during COMMIT. */
  failOnCommit: unknown = null;
  /** Runs once, right after the next transaction commits: a write that landed while the tool ran. */
  afterNextCommit: (() => void) | null = null;
  /** Every raw statement, in order, with its values left out: one list per transaction. */
  statementLog: string[][] = [];
  /** How many transactions were opened and how many statements changed rows. */
  transactions = 0;
  writes = 0;
  disconnects = 0;

  rows(model: string): readonly Row[] {
    modelNamed(model);
    return this.tables.get(model) ?? [];
  }

  /** Every table as one string, for "nothing changed" comparisons. */
  snapshot(): string {
    const sorted = [...this.tables.entries()].sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(sorted);
  }

  /** Every string held anywhere in the database: ids, names, logins, emails. */
  allStrings(): readonly string[] {
    const found = new Set<string>();
    for (const rows of this.tables.values()) {
      for (const row of rows) {
        for (const value of Object.values(row)) if (typeof value === "string") found.add(value);
      }
    }
    return [...found];
  }

  insert(model: string, data: Row): Row {
    const definition = modelNamed(model);
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const field = definition.fields.find((candidate) => candidate.name === key);
      if (!field || field.kind === "object") throw new Error(`The schema has no column ${model}.${key}`);
      row[key] = data[key];
    }
    for (const field of definition.fields) {
      if (field.kind === "object" || field.kind === "unsupported" || field.name in row) continue;
      if (field.isId && field.type === "String") row[field.name] = `${model}#${(this.sequence += 1)}`;
      else if (field.isUpdatedAt || field.hasDefaultValue) row[field.name] = isRecord(field.default) ? null : (field.default ?? null);
      else if (field.isRequired) throw new Error(`${model}.${field.name} is required`);
      else row[field.name] = null;
    }
    this.tables.set(model, [...this.rows(model), row]);
    return row;
  }

  private parentOf(edge: Edge, row: Row): Row | undefined {
    if (edge.from.some((column) => row[column] === null || row[column] === undefined)) return undefined;
    return this.rows(edge.parent).find((parent) => edge.from.every((column, index) => parent[edge.to[index]] === row[column]));
  }

  private matches(model: Model, row: Row, where: unknown): boolean {
    if (where === undefined) return true;
    if (!isRecord(where)) throw new Error(`A where clause for ${model.name} must be an object`);
    return Object.entries(where).every(([key, condition]) => {
      if (key === "AND") return listOf(condition).every((part) => this.matches(model, row, part));
      if (key === "OR") return listOf(condition).some((part) => this.matches(model, row, part));
      if (key === "NOT") return listOf(condition).every((part) => !this.matches(model, row, part));
      const field = model.fields.find((candidate) => candidate.name === key);
      if (!field) throw new Error(`The schema has no field ${model.name}.${key}`);
      if (field.kind !== "object") return scalarMatches(row[key], condition);
      const edge = EDGES.find((candidate) => candidate.child === model.name && candidate.relation === key);
      if (!edge) throw new Error(`The fake database only follows a relation from the row that holds the key: ${model.name}.${key}`);
      const parent = this.parentOf(edge, row);
      if (condition === null) return parent === undefined;
      return parent !== undefined && this.matches(modelNamed(edge.parent), parent, condition);
    });
  }

  /** Removes rows and applies every foreign key's delete rule to their children. */
  private remove(model: string, doomed: readonly Row[]): void {
    if (doomed.length === 0) return;
    this.tables.set(model, this.rows(model).filter((row) => !doomed.includes(row)));
    for (const edge of EDGES.filter((candidate) => candidate.parent === model)) {
      const pointsAtDoomed = (child: Row) =>
        doomed.some((parent) => edge.from.every((column, index) => child[column] !== null && child[column] === parent[edge.to[index]]));
      const children = this.rows(edge.child).filter(pointsAtDoomed);
      if (children.length === 0) continue;
      if (edge.onDelete === "Cascade") this.remove(edge.child, children);
      else if (edge.onDelete === "Restrict") throw new Error(`Foreign key ${edge.child}.${edge.from.join(",")} restricts this delete`);
      else {
        const cleared = Object.fromEntries(edge.from.map((column) => [column, null]));
        this.tables.set(edge.child, this.rows(edge.child).map((row) => (children.includes(row) ? { ...row, ...cleared } : row)));
      }
    }
  }

  /**
   * What a limited role may read. With row security on, Postgres quietly
   * filters the rows out. With it off, Postgres refuses the statement instead.
   */
  private readable(model: string, rowSecurityOff: boolean): readonly Row[] {
    if (this.superuser || this.bypassesRls) return this.rows(model);
    if (rowSecurityOff) throw new Error(`query would be affected by row-level security policy for table "${model}"`);
    return [];
  }

  private delegate(model: Model, state: { rowSecurityOff: boolean }): Delegate {
    const select = (where: unknown) => this.readable(model.name, state.rowSecurityOff).filter((row) => this.matches(model, row, where));
    return {
      count: async (args) => select(args?.where).length,
      findMany: async (args) => {
        const columns = Object.keys(args.select ?? {});
        return select(args.where).map((row) => (columns.length === 0 ? row : Object.fromEntries(columns.map((column) => [column, row[column]]))));
      },
      deleteMany: async (args) => {
        if (this.failOnDeleteOf === model.name) throw this.failure ?? new Error(`Injected failure while deleting ${model.name}`);
        const doomed = select(args.where);
        if (doomed.length > 0) this.writes += 1;
        this.remove(model.name, doomed);
        return { count: doomed.length };
      },
      create: async (args) => {
        this.writes += 1;
        return this.insert(model.name, args.data);
      },
    };
  }

  /** The tool's fixed statements, answered from this fake's state. Any other statement is refused. */
  private raw(state: { rowSecurityOff: boolean }, strings: readonly string[], values: readonly unknown[]): unknown {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    this.statementLog.at(-1)?.push(sql);
    if (sql === "SET LOCAL row_security = off") {
      state.rowSecurityOff = true;
      return 0;
    }
    if (LOCK_STATEMENT.test(sql)) return [{ locked: !this.createLockHeld }];
    if (sql.includes("current_database()")) return [{ database: this.database, address: this.serverAddress, now: this.now }];
    if (sql.includes("pg_roles")) return [{ rolsuper: this.superuser, rolbypassrls: this.bypassesRls }];
    if (sql.includes("to_regclass")) return [{ in_app_schema: this.ledgerSchema === "visionquest", in_public: this.ledgerSchema === "public" }];
    if (sql.includes('"_prisma_migrations"')) {
      const schema = sql.includes('visionquest."_prisma_migrations"') ? "visionquest" : "public";
      if (schema !== this.ledgerSchema) throw new Error(`relation "${schema}._prisma_migrations" does not exist`);
      return [{ newest: [...this.appliedMigrations].sort().at(-1) ?? null }];
    }
    const orphan = ORPHAN_STATEMENT.exec(sql);
    if (orphan) return [{ orphans: this.orphans(orphan, flatValues(values), state.rowSecurityOff) }];
    if (sql.includes('FROM visionquest."Notification" n')) return this.notices(new Set(flatValues(values)), state.rowSecurityOff);
    if (sql.includes('visionquest."BackgroundJob"') && sql.includes("payload::jsonb->>'studentId'")) {
      const named = new Set(flatValues(values));
      return this.readable("BackgroundJob", state.rowSecurityOff).filter((row) => named.has(studentIdIn(row.payload))).map((row) => ({ id: row.id }));
    }
    throw new Error(`The fake database does not know this statement: ${sql}`);
  }

  /** Answers an orphan probe: rows whose id column names no row of the parent table. */
  private orphans(match: RegExpExecArray, values: readonly unknown[], rowSecurityOff: boolean): number {
    const [, model, column, kindColumn, parent] = match;
    const parentIds = new Set(this.readable(parent, rowSecurityOff).map((row) => row.id));
    return this.readable(model, rowSecurityOff).filter((row) => {
      const value = row[column];
      if (typeof value !== "string" || value === "system") return false;
      if (kindColumn && !values.includes(row[kindColumn])) return false;
      return !parentIds.has(value);
    }).length;
  }

  /** Answers the staff notice statement: notices to unmarked staff that hold a named account's display name. */
  private notices(accountIds: ReadonlySet<unknown>, rowSecurityOff: boolean): Row[] {
    const people = this.readable("Student", rowSecurityOff);
    const names = people.filter((row) => accountIds.has(row.id)).map((row) => String(row.displayName ?? "")).filter((name) => name.length > 0);
    const staff = new Set(people.filter((row) => row.demoAccount === null && row.role !== "student").map((row) => row.id));
    return this.readable("Notification", rowSecurityOff)
      .filter((row) => staff.has(row.studentId) && names.some((name) => `${String(row.title)} ${String(row.body ?? "")}`.includes(name)))
      .map((row) => ({ id: row.id }));
  }

  private tx(): FakeTx {
    const state = { rowSecurityOff: false };
    this.statementLog.push([]);
    const tx: FakeTx = {
      $executeRaw: async (strings, ...values) => Number(this.raw(state, strings, values)),
      $queryRaw: async (query, ...values) => (isSql(query) ? this.raw(state, query.strings, query.values) : this.raw(state, query, values)),
    };
    for (const model of MODELS) tx[delegateKey(model.name)] = this.delegate(model, state);
    return tx;
  }

  /** A client whose transaction rolls every table back when the callback throws. */
  client(): FakeClient {
    return {
      $transaction: async (run) => {
        this.transactions += 1;
        const before = new Map(this.tables);
        let result;
        try {
          result = await run(this.tx());
        } catch (error) {
          this.tables = before;
          throw error;
        }
        if (this.failOnCommit !== null) throw this.failOnCommit;
        const landed = this.afterNextCommit;
        this.afterNextCommit = null;
        landed?.();
        return result;
      },
      $disconnect: async () => {
        this.disconnects += 1;
      },
    };
  }
}

/** Where `seedUniverse` writes: the fake's `insert`, or a Prisma delegate's `create`. */
export type SeedWriter = (model: string, data: Row) => Promise<void>;

export interface SeedOptions {
  /** Starts every id and every text value, so one universe's rows are easy to tell from another's. */
  readonly prefix: string;
  /** True marks the two accounts as demo and gives the teacher and class the demo login and code. */
  readonly demo: boolean;
  /** True records a model whose row the database refused and carries on, for Postgres. */
  readonly tolerant?: boolean;
}

export interface SeededUniverse {
  readonly prefix: string;
  readonly studentId: string;
  readonly staffId: string;
  readonly classId: string;
  /** Every row written, in order, with its id when the model has one. */
  readonly created: ReadonlyArray<{ model: string; id: string | null }>;
  /** Models the database refused a row for (only when `tolerant`). */
  readonly skipped: readonly string[];
}

const FIXED_DATE = new Date("2026-11-01T12:00:00.000Z");
/** A column that names the staff member who acted: verifiedBy, reviewedBy, assignedById, actorId. */
const ACTOR_COLUMN = /(By|ById)$|^actorId$/;
const ENUMS = new Map(Prisma.dmmf.datamodel.enums.map((entry) => [entry.name, entry.values[0]?.name]));

class UniverseSeeder {
  private readonly rows = new Map<string, Row>();
  private readonly building = new Set<string>();
  private readonly failed = new Set<string>();
  private extras = 0;
  readonly created: Array<{ model: string; id: string | null }> = [];
  readonly studentId: string;
  readonly staffId: string;
  readonly classId: string;

  constructor(private readonly write: SeedWriter, readonly options: SeedOptions) {
    this.studentId = `${options.prefix}student`;
    this.staffId = `${options.prefix}staff`;
    this.classId = `${options.prefix}class`;
  }

  get skipped(): readonly string[] {
    return [...this.failed];
  }

  private async put(model: string, data: Row): Promise<boolean> {
    try {
      await this.write(model, data);
    } catch (error) {
      if (!this.options.tolerant) throw error;
      this.failed.add(model);
      return false;
    }
    this.created.push({ model, id: typeof data.id === "string" ? data.id : null });
    return true;
  }

  async roots(): Promise<void> {
    const { prefix, demo } = this.options;
    const account = (id: string, role: string, login: string, kind: string) => ({
      id, studentId: login, displayName: `${prefix} ${role} Name`, email: `${prefix}${role}@example.test`,
      role, demoAccount: demo ? kind : null,
    });
    await this.write("Student", account(this.studentId, "student", demo ? `demo-${prefix}visitor` : `${prefix}login-student`, "student"));
    await this.write("Student", account(this.staffId, "teacher", demo ? DEMO_INSTRUCTOR_LOGIN : `${prefix}login-teacher`, "instructor"));
    const classroom = {
      id: this.classId, code: demo ? DEMO_CLASS_CODE : `${prefix}class-code`, name: `${prefix} Class`, createdById: this.staffId,
    };
    await this.write("SpokesClass", classroom);
    this.created.push({ model: "Student", id: this.studentId }, { model: "Student", id: this.staffId }, { model: "SpokesClass", id: this.classId });
    this.rows.set("SpokesClass", classroom);
  }

  /** The account a foreign key to Student gets, or undefined to leave the column empty. */
  private accountFor(model: Model, edge: Edge): string | undefined {
    if (edge.from[0] === "studentId") return this.studentId;
    const ownedByStudent = model.fields.some((field) => field.name === "studentId");
    return edge.required || ownedByStudent ? this.staffId : undefined;
  }

  private scalar(model: Model, field: Field, suffix: string): unknown {
    if (field.isList) return [];
    if (field.type === "String") return ACTOR_COLUMN.test(field.name) ? this.staffId : `${this.options.prefix}${model.name}.${field.name}${suffix}`;
    if (field.type === "Int" || field.type === "Float") return 1;
    if (field.type === "Boolean") return false;
    if (field.type === "DateTime") return FIXED_DATE;
    if (field.type === "Json") return {};
    if (field.kind === "enum") return ENUMS.get(field.type);
    throw new Error(`The seeder cannot fill ${model.name}.${field.name} (${field.type})`);
  }

  /** Values for every plain column: an id, each required column, and each staff "by" column. */
  private columns(model: Model, suffix: string): Record<string, unknown> {
    const keys = new Set(EDGES.filter((edge) => edge.child === model.name).flatMap((edge) => edge.from));
    const data: Record<string, unknown> = {};
    for (const field of model.fields) {
      if (field.kind === "object" || field.kind === "unsupported" || keys.has(field.name)) continue;
      if (field.isId && field.type === "String") data[field.name] = `${this.options.prefix}${model.name}${suffix}`;
      else if (field.isUpdatedAt || field.hasDefaultValue) continue;
      else if (field.isRequired || (field.type === "String" && !field.isList && ACTOR_COLUMN.test(field.name))) {
        data[field.name] = this.scalar(model, field, suffix);
      }
    }
    return data;
  }

  /** Values for every foreign key, creating a parent row the first time one is needed. */
  private async keys(model: Model): Promise<Record<string, unknown> | null> {
    const data: Record<string, unknown> = {};
    for (const edge of EDGES.filter((candidate) => candidate.child === model.name)) {
      if (edge.parent === model.name) continue;
      if (edge.parent === "Student") {
        const account = this.accountFor(model, edge);
        if (account) data[edge.from[0]] = account;
        continue;
      }
      const parent = this.building.has(edge.parent) ? null : await this.ensure(edge.parent);
      if (parent) edge.from.forEach((column, index) => (data[column] = parent[edge.to[index]]));
      else if (edge.required) return null;
    }
    return data;
  }

  /** This universe's one row of `model`, written on first use; null when it could not be written. */
  async ensure(name: string): Promise<Row | null> {
    const existing = this.rows.get(name);
    if (existing) return existing;
    if (this.failed.has(name)) return null;
    const model = modelNamed(name);
    this.building.add(name);
    const keys = await this.keys(model);
    this.building.delete(name);
    if (!keys) {
      // A required parent could not be written. Only Postgres may do that to us.
      if (!this.options.tolerant) throw new Error(`The seeder could not link a row of ${name} to its parents`);
      this.failed.add(name);
      return null;
    }
    const data = { ...this.columns(model, ""), ...keys };
    if (!(await this.put(name, data))) return null;
    this.rows.set(name, data);
    return data;
  }

  /** One more row of `model` with the given columns set, the rest filled as usual. */
  async extra(name: string, overrides: Row): Promise<void> {
    if (this.failed.has(name)) return;
    const model = modelNamed(name);
    const keys = await this.keys(model);
    if (!keys) return;
    await this.put(name, { ...this.columns(model, `.x${(this.extras += 1)}`), ...keys, ...overrides });
  }
}

/** True when a row of this model, written by the seeder, would name an account. */
function namesAnAccount(model: Model): boolean {
  const toStudent = EDGES.filter((edge) => edge.child === model.name && edge.parent === "Student");
  if (toStudent.length === 0) return true;
  return toStudent.some((edge) => edge.from[0] === "studentId" || edge.required);
}

/** Rows that name an account or a class in a column with no foreign key. */
async function seedSoftReferences(seeder: UniverseSeeder): Promise<void> {
  const { studentId, staffId, classId } = seeder;
  await seeder.extra("AuditLog", { actorId: studentId, targetId: studentId });
  await seeder.extra("AuditLog", { actorId: staffId, targetId: classId });
  await seeder.extra("AuditLog", { actorId: null, targetId: studentId });
  await seeder.extra("SageOperation", { actorId: studentId, targetStudentId: studentId });
  await seeder.extra("SageOperation", { actorId: staffId, targetStudentId: studentId });
  await seeder.extra("SageOperation", { actorId: "system", targetStudentId: studentId });
  await seeder.extra("OutboundMessage", { toId: studentId, connectionId: null });
  await seeder.extra("FormAssignment", { assignedById: staffId, scope: "student", targetId: studentId });
  await seeder.extra("FormAssignment", { assignedById: staffId, scope: "class", targetId: classId });
  await seeder.extra("GrantKpiSnapshot", { classId });
  await seeder.extra("BackgroundJob", { type: "extract_memory", payload: JSON.stringify({ studentId }) });
  const memory = (id: string, subjectType: string, subjectId: string) => seeder.extra("SageMemory", { id, subjectType, subjectId });
  const { prefix } = seeder.options;
  await memory(`${prefix}memory-student`, "student", studentId);
  await memory(`${prefix}memory-class`, "class", classId);
  // An edge to and from a memory about neither, so each side of each subject is deleted on its own.
  await memory(`${prefix}memory-other`, "program", `${prefix}program`);
  for (const subject of ["student", "class"]) {
    await seeder.extra("SageMemoryEdge", { fromId: `${prefix}memory-${subject}`, toId: `${prefix}memory-other` });
    await seeder.extra("SageMemoryEdge", { fromId: `${prefix}memory-other`, toId: `${prefix}memory-${subject}` });
  }
}

/**
 * Writes one universe: a student, a teacher, their class, one row in every
 * model below Student and SpokesClass, and the rows that name them with no
 * foreign key. Shared program rows (an employer, an event, a form template)
 * are written as parents with no creator, so they are "merely referenced".
 */
export async function seedUniverse(write: SeedWriter, options: SeedOptions): Promise<SeededUniverse> {
  const seeder = new UniverseSeeder(write, options);
  await seeder.roots();
  const below = new Set([...modelsBelow("Student"), ...modelsBelow("SpokesClass")]);
  for (const model of MODELS) {
    if (model.name === "Student" || model.name === "SpokesClass" || !below.has(model.name)) continue;
    if (namesAnAccount(model)) await seeder.ensure(model.name);
  }
  await seedSoftReferences(seeder);
  const { prefix } = options;
  return { prefix, studentId: seeder.studentId, staffId: seeder.staffId, classId: seeder.classId, created: seeder.created, skipped: seeder.skipped };
}

/** What the tests tell the closeout about this checkout: it matches the fake database. */
export const LOCAL = { newestMigration: FAKE_MIGRATION, schemaModels: MODELS.map((model) => model.name) } as const;

export interface Scene {
  readonly db: FakeDb;
  /** The universe marked as demo, under the prefix `dm-`. */
  readonly demo: SeededUniverse;
  /** The universe of people with no demo mark, under the prefix `rl-`. */
  readonly real: SeededUniverse;
}

/** A fake database holding one marked and one unmarked universe. */
export async function scene(): Promise<Scene> {
  const db = new FakeDb();
  const write = async (model: string, data: Row) => void db.insert(model, data);
  const demo = await seedUniverse(write, { prefix: "dm-", demo: true });
  const real = await seedUniverse(write, { prefix: "rl-", demo: false });
  return { db, demo, real };
}

/** A copy of the universe's own row of `model`, with some columns changed. */
export function copyOf(db: FakeDb, model: string, prefix: string, changes: Row): Row {
  const original = db.rows(model).find((row) => JSON.stringify(row).includes(prefix));
  if (!original) throw new Error(`the ${prefix} universe has no ${model} row`);
  return db.insert(model, { ...original, id: `${prefix}${model}.copy${db.rows(model).length}`, ...changes });
}
