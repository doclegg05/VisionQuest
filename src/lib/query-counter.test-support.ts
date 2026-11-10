/**
 * A stand-in for `@/lib/db` that counts the queries code issues, with no
 * database. Register it the way tests already mock the module:
 *
 *   const counter = createQueryCounter({ "goal.count": 2 });
 *   mock.module("@/lib/db", { exports: counter.dbModule });
 *
 * One entry is recorded per Prisma call (a model operation or a raw query),
 * on the client that received it. That is the unit the app pays for:
 * `src/lib/db.ts` wraps every app-client call in its own transaction.
 *
 * What it does not see: SQL. `relationLoads` is read from the call's
 * `select` / `include`, where Prisma's default strategy sends one more SELECT
 * per nested relation when the parent rows exist. It is derived, not observed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";

export type QueryClient = "app" | "admin";

export interface QueryCaller {
  /** The function that issued the query, as the stack names it. */
  readonly fn: string;
  /** Path relative to the working directory. */
  readonly file: string;
  readonly line: number;
}

export interface RecordedQuery {
  readonly client: QueryClient;
  /** Model in client casing ("studentTask"), or "(raw)". */
  readonly model: string;
  readonly operation: string;
  readonly inInteractiveTransaction: boolean;
  /** Nested relations in `select` / `include`. Derived from arguments. */
  readonly relationLoads: number;
  /** "default" means no fixture was set and the empty result was returned. */
  readonly answeredBy: "fixture" | "default";
  readonly caller: QueryCaller;
}

export interface RecordedTransaction {
  readonly client: QueryClient;
  readonly kind: "batch" | "interactive";
}

/**
 * Results by "model.operation" ("goal.count"), or by raw method
 * ("$queryRaw"). Prefix a key with "admin:" to answer the admin client only.
 * A function value is called with the call's arguments; a raw query's
 * function gets `{ sql, values }`.
 */
export type QueryFixtures = Readonly<Record<string, unknown>>;

/** What a Prisma client extension is handed for one finished query. */
export interface ObservedQuery {
  readonly query: RecordedQuery;
  /** Prisma's own model name ("StudentTask"); undefined for a raw query. */
  readonly prismaModel: string | undefined;
  readonly args: unknown;
  readonly result: unknown;
}

export type QueryObserver = (event: ObservedQuery) => void;

export interface CallerSummary {
  readonly file: string;
  readonly fn: string;
  readonly app: number;
  readonly admin: number;
  readonly queries: readonly RecordedQuery[];
}

export interface QuerySummary {
  readonly app: number;
  readonly admin: number;
  readonly total: number;
  readonly relationLoads: number;
  readonly byCaller: readonly CallerSummary[];
}

export interface QueryCounter {
  /** Pass to `mock.module("@/lib/db", { exports: ... })`. */
  readonly dbModule: Readonly<Record<"prisma" | "prismaAdmin" | "withAppTransaction", unknown>>;
  queries(): readonly RecordedQuery[];
  transactions(): readonly RecordedTransaction[];
  /** Runs `work` and returns the queries issued before it settled. */
  section<T>(work: () => Promise<T>): Promise<{ value: T; queries: readonly RecordedQuery[] }>;
  /** Replaces the whole fixture set. */
  useFixtures(fixtures: QueryFixtures): void;
  /**
   * Calls `observer` after each query resolves, or stops with null. This is
   * where a test mirrors an extension `src/lib/db.ts` puts on the real client.
   */
  observe(observer: QueryObserver | null): void;
  reset(): void;
}

const MODEL_OPERATIONS = [
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn",
  "upsert", "delete", "deleteMany", "count", "aggregate", "groupBy",
] as const;
type ModelOperation = (typeof MODEL_OPERATIONS)[number];

const RAW_OPERATIONS = ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"] as const;
type RawOperation = (typeof RAW_OPERATIONS)[number];

const RAW_MODEL = "(raw)";
const ADMIN_FIXTURE_PREFIX = "admin:";
const UNKNOWN_CALLER: QueryCaller = { fn: "(unknown)", file: "(unknown)", line: 0 };
const SUPPORT_FILE = path.basename(__filename);

function clientCase(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/** Client casing ("studentTask") -> Prisma's model name ("StudentTask"). */
const PRISMA_MODEL_BY_CLIENT_NAME: ReadonlyMap<string, string> = new Map(
  Object.values(Prisma.ModelName).map((name) => [clientCase(name), name]),
);
const MODEL_NAMES: readonly string[] = [...PRISMA_MODEL_BY_CLIENT_NAME.keys()];

/** model -> relation field -> related model, all in client casing. */
const RELATIONS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    clientCase(model.name),
    new Map(
      model.fields
        .filter((field) => field.kind === "object")
        .map((field) => [field.name, clientCase(field.type)]),
    ),
  ]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResolver(value: unknown): value is (args: unknown) => unknown {
  return typeof value === "function";
}

function isModelOperation(value: string): value is ModelOperation {
  return MODEL_OPERATIONS.some((operation) => operation === value);
}

function isRawOperation(value: string): value is RawOperation {
  return RAW_OPERATIONS.some((operation) => operation === value);
}

function countSelection(model: string, selection: unknown): number {
  if (!isRecord(selection)) return 0;
  const relations = RELATIONS.get(model);
  let total = 0;
  for (const [field, value] of Object.entries(selection)) {
    const related = relations?.get(field);
    if (!related || value === false || value === null || value === undefined) continue;
    total += 1 + countRelationLoads(related, value);
  }
  return total;
}

function countRelationLoads(model: string, args: unknown): number {
  if (!isRecord(args)) return 0;
  return countSelection(model, args.select) + countSelection(model, args.include);
}

/** `at name (location:line:col)` or `at location:line:col`, source-mapped. */
function parseFrame(line: string): QueryCaller | null {
  const body = /^\s*at (?:async )?(.*)$/.exec(line)?.[1];
  if (!body) return null;
  const named = /^(.+?) \((.+):(\d+):\d+\)$/.exec(body);
  const bare = named ? null : /^(.+):(\d+):\d+$/.exec(body);
  const location = named ? named[2] : bare?.[1];
  const lineText = named ? named[3] : bare?.[2];
  if (!location || !lineText) return null;
  const name = named?.[1] ?? "<anonymous>";
  return {
    // V8 prints a nameless function as "<anonymous>" or "Receiver.<anonymous>".
    fn: name.endsWith("<anonymous>") ? "(anonymous)" : name,
    file: location.startsWith("file://") ? fileURLToPath(location) : location,
    line: Number(lineText),
  };
}

/** The nearest frame in this repository that is not this file. */
function captureCaller(): QueryCaller {
  const stack = new Error("query issued here").stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    const frame = parseFrame(line);
    if (!frame || !path.isAbsolute(frame.file)) continue;
    const relative = path.relative(process.cwd(), frame.file);
    if (relative.startsWith("..") || relative.includes("node_modules")) continue;
    if (path.basename(relative) === SUPPORT_FILE) continue;
    return { ...frame, file: relative };
  }
  return UNKNOWN_CALLER;
}

/** Sent on first `then`, like a PrismaPromise: never awaited, never sent. */
class LazyQuery implements PromiseLike<unknown> {
  #sent: Promise<unknown> | undefined;
  readonly #send: () => unknown;

  constructor(send: () => unknown) {
    this.#send = send;
  }

  #start(): Promise<unknown> {
    this.#sent ??= new Promise((resolve) => resolve(this.#send()));
    return this.#sent;
  }

  then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.#start().then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<unknown> {
    return this.#start().catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<unknown> {
    return this.#start().finally(onFinally);
  }
}

function writtenRow(model: string, args: unknown, ...sources: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = { id: `${model}-fixture-id` };
  if (!isRecord(args)) return row;
  return sources.reduce(
    (merged, source) => (isRecord(args[source]) ? { ...merged, ...args[source] } : merged),
    row,
  );
}

/** The empty answer for an operation, so unfixtured reads take the "nothing there" branch. */
function defaultResult(model: string, operation: ModelOperation, args: unknown): unknown {
  switch (operation) {
    case "findMany":
    case "groupBy":
    case "createManyAndReturn":
    case "updateManyAndReturn":
      return [];
    case "findUnique":
    case "findFirst":
      return null;
    case "findUniqueOrThrow":
    case "findFirstOrThrow":
      throw new Error(`No fixture for ${model}.${operation}; the real client would throw NotFound.`);
    case "count":
      return 0;
    case "createMany":
    case "updateMany":
    case "deleteMany":
      return { count: 0 };
    case "aggregate":
      return {};
    case "create":
      return writtenRow(model, args, "data");
    case "update":
      return writtenRow(model, args, "where", "data");
    case "upsert":
      return writtenRow(model, args, "where", "create");
    case "delete":
      return writtenRow(model, args, "where");
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

function assertKnownFixtureKeys(fixtures: QueryFixtures): void {
  for (const key of Object.keys(fixtures)) {
    const target = key.startsWith(ADMIN_FIXTURE_PREFIX) ? key.slice(ADMIN_FIXTURE_PREFIX.length) : key;
    if (isRawOperation(target)) continue;
    const [model, operation, ...rest] = target.split(".");
    const known =
      rest.length === 0 && model !== undefined && operation !== undefined &&
      MODEL_NAMES.includes(model) && isModelOperation(operation);
    if (!known) throw new Error(`Query fixture "${key}" names no Prisma model operation or raw method.`);
  }
}

function rawCallArguments(first: unknown, rest: readonly unknown[]): { sql: string; values: readonly unknown[] } {
  if (typeof first === "string") return { sql: first, values: rest };
  if (Array.isArray(first)) return { sql: first.join("?"), values: rest };
  if (isRecord(first) && Array.isArray(first.strings) && Array.isArray(first.values)) {
    return { sql: first.strings.join("?"), values: first.values };
  }
  throw new Error("Raw query was called with neither a template, a Prisma.sql value, nor a string.");
}

type Queryable = Record<string, unknown>;

/** The counter's state and the fake clients that write to it. */
class Recorder {
  fixtures: QueryFixtures;
  observer: QueryObserver | null = null;
  readonly queries: RecordedQuery[] = [];
  readonly transactions: RecordedTransaction[] = [];

  constructor(fixtures: QueryFixtures) {
    this.fixtures = fixtures;
  }

  /** The fixture for this call, admin-only first, or the operation's empty answer. */
  #answer(client: QueryClient, key: string, args: unknown, fallback: () => unknown) {
    const adminKey = `${ADMIN_FIXTURE_PREFIX}${key}`;
    const fixtureKey = client === "admin" && Object.hasOwn(this.fixtures, adminKey) ? adminKey : key;
    if (!Object.hasOwn(this.fixtures, fixtureKey)) return { answeredBy: "default" as const, resolve: fallback };
    const fixture = this.fixtures[fixtureKey];
    return { answeredBy: "fixture" as const, resolve: () => (isResolver(fixture) ? fixture(args) : fixture) };
  }

  /** Records the query, resolves its answer, then tells the observer. */
  async #send(query: RecordedQuery, args: unknown, resolve: () => unknown): Promise<unknown> {
    this.queries.push(query);
    const result = await resolve();
    this.observer?.({ query, prismaModel: PRISMA_MODEL_BY_CLIENT_NAME.get(query.model), args, result });
    return result;
  }

  #modelDelegate(client: QueryClient, model: string, inInteractiveTransaction: boolean): Queryable {
    return Object.fromEntries(MODEL_OPERATIONS.map((operation) => [operation, (args?: unknown) => {
      const caller = captureCaller();
      return new LazyQuery(() => {
        const { answeredBy, resolve } = this.#answer(client, `${model}.${operation}`, args, () =>
          defaultResult(model, operation, args));
        return this.#send({
          client, model, operation, inInteractiveTransaction, answeredBy, caller,
          relationLoads: countRelationLoads(model, args),
        }, args, resolve);
      });
    }]));
  }

  #rawMethods(client: QueryClient, inInteractiveTransaction: boolean): Queryable {
    return Object.fromEntries(RAW_OPERATIONS.map((operation) => [operation, (first: unknown, ...rest: unknown[]) => {
      const caller = captureCaller();
      return new LazyQuery(() => {
        const empty = operation.startsWith("$queryRaw") ? [] : 0;
        const rawArgs = rawCallArguments(first, rest);
        const { answeredBy, resolve } = this.#answer(client, operation, rawArgs, () => empty);
        return this.#send({
          client, model: RAW_MODEL, operation, inInteractiveTransaction, answeredBy, caller, relationLoads: 0,
        }, rawArgs, resolve);
      });
    }]));
  }

  #queryable(client: QueryClient, inInteractiveTransaction: boolean): Queryable {
    return {
      ...Object.fromEntries(
        MODEL_NAMES.map((model) => [model, this.#modelDelegate(client, model, inInteractiveTransaction)]),
      ),
      ...this.#rawMethods(client, inInteractiveTransaction),
    };
  }

  interactive<T>(client: QueryClient, work: (tx: Queryable) => Promise<T>): Promise<T> {
    this.transactions.push({ client, kind: "interactive" });
    return work(this.#queryable(client, true));
  }

  client(name: QueryClient): Queryable {
    return {
      ...this.#queryable(name, false),
      $transaction: async (input: unknown) => {
        if (isResolver(input)) return this.interactive(name, async (tx) => input(tx));
        if (!Array.isArray(input)) throw new Error("$transaction expects an array of queries or a function.");
        this.transactions.push({ client: name, kind: "batch" });
        const results: unknown[] = [];
        for (const query of input) results.push(await query);
        return results;
      },
    };
  }
}

export function createQueryCounter(initialFixtures: QueryFixtures = {}): QueryCounter {
  assertKnownFixtureKeys(initialFixtures);
  const recorder = new Recorder(initialFixtures);
  return {
    dbModule: {
      prisma: recorder.client("app"),
      prismaAdmin: recorder.client("admin"),
      withAppTransaction: <T>(work: (tx: Queryable) => Promise<T>) => recorder.interactive("app", work),
    },
    queries: () => [...recorder.queries],
    transactions: () => [...recorder.transactions],
    async section(work) {
      const start = recorder.queries.length;
      const value = await work();
      return { value, queries: recorder.queries.slice(start) };
    },
    useFixtures(next) {
      assertKnownFixtureKeys(next);
      recorder.fixtures = next;
    },
    observe(next) {
      recorder.observer = next;
    },
    reset() {
      recorder.queries.length = 0;
      recorder.transactions.length = 0;
    },
  };
}

export function summarizeQueries(queries: readonly RecordedQuery[]): QuerySummary {
  const groups = new Map<string, RecordedQuery[]>();
  for (const query of queries) {
    const key = `${query.caller.file}\u0000${query.caller.fn}`;
    groups.set(key, [...(groups.get(key) ?? []), query]);
  }
  const countFor = (list: readonly RecordedQuery[], client: QueryClient) =>
    list.filter((query) => query.client === client).length;
  const byCaller = [...groups.values()].flatMap((list) => {
    const [first] = list;
    if (!first) return [];
    return [{
      file: first.caller.file, fn: first.caller.fn,
      app: countFor(list, "app"), admin: countFor(list, "admin"), queries: list,
    }];
  });
  return {
    app: countFor(queries, "app"),
    admin: countFor(queries, "admin"),
    total: queries.length,
    relationLoads: queries.reduce((sum, query) => sum + query.relationLoads, 0),
    byCaller,
  };
}

function queryName(query: RecordedQuery): string {
  return query.model === RAW_MODEL ? query.operation : `${query.model}.${query.operation}`;
}

function describeQuery(query: RecordedQuery): string {
  const name = queryName(query);
  const relations = query.relationLoads > 0 ? `(+${query.relationLoads} relations)` : "";
  return `${name}:${query.caller.line}${relations}${query.inInteractiveTransaction ? "[tx]" : ""}`;
}

/** One line per issuing function: its file, its counts, and each query with its source line. */
export function formatQueryBreakdown(label: string, queries: readonly RecordedQuery[]): string {
  const summary = summarizeQueries(queries);
  const fnWidth = Math.max(0, ...summary.byCaller.map((row) => row.fn.length));
  const fileWidth = Math.max(0, ...summary.byCaller.map((row) => row.file.length));
  const rows = summary.byCaller.map((row) => {
    const counts = [row.app > 0 ? `app ${row.app}` : "", row.admin > 0 ? `admin ${row.admin}` : ""]
      .filter(Boolean)
      .join(", ");
    return `  ${row.fn.padEnd(fnWidth)}  ${row.file.padEnd(fileWidth)}  ${counts}  ${row.queries.map(describeQuery).join(", ")}`;
  });
  const unfixtured = queries.filter((query) => query.answeredBy === "default").map(queryName);
  return [
    `${label}: app ${summary.app}, admin ${summary.admin}, nested relation loads ${summary.relationLoads}`,
    ...rows,
    ...(unfixtured.length > 0
      ? [`  answered by default (${unfixtured.length} of ${queries.length}): ${[...new Set(unfixtured)].join(", ")}`]
      : []),
  ].join("\n");
}

/** "file › function" -> [app, admin]: a shape a test can pin and a diff can show. */
export function countsByFunction(queries: readonly RecordedQuery[]): Record<string, [number, number]> {
  return Object.fromEntries(
    summarizeQueries(queries).byCaller.map((row) => [`${row.file} › ${row.fn}`, [row.app, row.admin]]),
  );
}

export interface QueryCountReport {
  /** The path's name as `scripts/readiness/query-count.mjs` takes it. */
  readonly path: string;
  readonly cache: "cold" | "warm";
  readonly queries: readonly RecordedQuery[];
  /** Queries counted by reading the source because the test could not run them. */
  readonly readNotExecuted: number;
}

/** The line `scripts/readiness/query-count.mjs` parses. Change both together. */
export function queryCountLine(report: QueryCountReport): string {
  const summary = summarizeQueries(report.queries);
  return [
    "QUERY_COUNT",
    `path=${report.path}`,
    `cache=${report.cache}`,
    `app=${summary.app}`,
    `admin=${summary.admin}`,
    `relationLoads=${summary.relationLoads}`,
    `read=${report.readNotExecuted}`,
  ].join(" ");
}
