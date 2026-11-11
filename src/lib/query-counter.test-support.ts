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
 * What it does not see: SQL. Nested relation loads are derived, not
 * observed: Prisma's default relation strategy ("query"; this schema enables
 * no `relationJoins`) sends one more SELECT per nested relation, and only when
 * the level above it returned rows. `estimateRoundTrips` turns the record into
 * round trips; its header states each rule and where it was confirmed.
 *
 * What "4 per app call" assumes: BEGIN, set_config, the query and COMMIT, with
 * both statements already prepared on that connection. A cold statement adds a
 * prepare round trip. When the app connects through a transaction pooler with
 * `pgbouncer=true`, Prisma turns its statement cache off, so one app call is
 * about 7 round trips and a nested load about 2. Every number this counter
 * gives is therefore a floor on wire round trips: good for comparing before
 * and after, not a latency budget. `APP_CALL_ROUND_TRIPS` stays 4 until it is
 * measured against Postgres.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { argumentShape, isCompactable } from "./readiness/admin-batching";

export type QueryClient = "app" | "admin";

export interface QueryCaller {
  /** The function that issued the query, as the stack names it. */
  readonly fn: string;
  /** Path relative to the working directory. */
  readonly file: string;
  readonly line: number;
}

/**
 * "batch": `$transaction([...])`. "interactive": `$transaction(async (tx) => ...)`.
 * "appTransaction": `withAppTransaction` or `withAppReadTransaction`, an
 * interactive transaction on the raw app client with its own isolation level
 * and set_config.
 */
export type TransactionKind = "batch" | "interactive" | "appTransaction";

export interface TransactionRef {
  readonly id: number;
  readonly kind: TransactionKind;
}

export interface RecordedQuery {
  readonly client: QueryClient;
  /** Model in client casing ("studentTask"), or "(raw)". */
  readonly model: string;
  readonly operation: string;
  readonly inInteractiveTransaction: boolean;
  /** The transaction the call ran in, or null for a call on its own. */
  readonly transaction: TransactionRef | null;
  /** Nested relations in `select` / `include`, read from the arguments alone. */
  readonly relationLoads: number;
  /**
   * The nested SELECTs the call would send for the result it got: a level that
   * returned no rows sends none below it. Where the result does not show a
   * relation (a write, or a fixture that leaves it out), or no fixture answered
   * the call, the arguments decide.
   */
  readonly nestedLoads: number;
  /**
   * Set on admin-client findUnique calls Prisma's dataloader sends as one
   * statement: same tick, model, operation and argument shape. Equal values share
   * one statement. See `estimateRoundTrips`.
   */
  readonly sameTickBatch: string | null;
  /** "default" means no fixture was set and the empty result was returned. */
  readonly answeredBy: "fixture" | "default";
  readonly caller: QueryCaller;
}

export interface RecordedTransaction extends TransactionRef {
  readonly client: QueryClient;
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
  readonly appNestedLoads: number;
  readonly adminNestedLoads: number;
  readonly byCaller: readonly CallerSummary[];
}

export interface QueryCounter {
  /** Pass to `mock.module("@/lib/db", { exports: ... })`. */
  readonly dbModule: Readonly<Record<"prisma" | "prismaAdmin" | "withAppTransaction" | "withAppReadTransaction", unknown>>;
  queries(): readonly RecordedQuery[];
  transactions(): readonly RecordedTransaction[];
  /** Runs `work` and returns the queries and transactions issued before it settled. */
  section<T>(work: () => Promise<T>): Promise<{
    value: T;
    queries: readonly RecordedQuery[];
    transactions: readonly RecordedTransaction[];
  }>;
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

/** A result as rows: nothing for null, one row for an object. */
function asRows(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

/** The nested SELECTs one selection sends below `parents`, a level that returned rows. */
function loadedSelection(model: string, selection: unknown, parents: readonly unknown[]): number {
  if (!isRecord(selection)) return 0;
  const relations = RELATIONS.get(model);
  let total = 0;
  for (const [field, value] of Object.entries(selection)) {
    const related = relations?.get(field);
    if (!related || value === false || value === null || value === undefined) continue;
    // Prisma sends the relation's SELECT because the parents exist.
    const shown = parents.every((row) => isRecord(row) && Object.hasOwn(row, field));
    total += 1 + (shown
      ? loadedRelations(related, value, parents.flatMap((row) => (isRecord(row) ? asRows(row[field]) : [])))
      : countRelationLoads(related, value));
  }
  return total;
}

/**
 * Nested loads for the rows a fixture returned. A level with no rows sends no
 * SELECT for the relations below it; a relation the result does not show is
 * counted in full from the arguments, the larger answer. A call no fixture
 * answered is not passed here: its loads are counted in full.
 */
function loadedRelations(model: string, args: unknown, result: unknown): number {
  const parents = asRows(result);
  if (!isRecord(args) || parents.length === 0) return 0;
  return loadedSelection(model, args.select, parents) + loadedSelection(model, args.include, parents);
}

const BATCHED_OPERATIONS: ReadonlySet<string> = new Set(["findUnique", "findUniqueOrThrow"]);
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
  readonly #send: (transaction: TransactionRef | null) => unknown;

  constructor(send: (transaction: TransactionRef | null) => unknown) {
    this.#send = send;
  }

  #start(transaction: TransactionRef | null = null): Promise<unknown> {
    this.#sent ??= new Promise((resolve) => resolve(this.#send(transaction)));
    return this.#sent;
  }

  /** Sends the query as part of a batch `$transaction([...])`. */
  runIn(transaction: TransactionRef): Promise<unknown> {
    return this.#start(transaction);
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

interface PendingQuery {
  readonly client: QueryClient;
  readonly model: string;
  readonly operation: string;
  readonly transaction: TransactionRef | null;
  readonly answeredBy: "fixture" | "default";
  readonly caller: QueryCaller;
  readonly args: unknown;
}

/** The counter's state and the fake clients that write to it. */
class Recorder {
  fixtures: QueryFixtures;
  observer: QueryObserver | null = null;
  readonly queries: RecordedQuery[] = [];
  readonly transactions: RecordedTransaction[] = [];
  #nextTransactionId = 1;
  #nextTick = 1;
  /** The open dataloader window: set by the first batchable call, closed on process.nextTick. */
  #openTick: number | null = null;

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

  /**
   * Mirrors Prisma 6's DataLoader (runtime/library.js): a findUnique outside a
   * transaction opens a window that closes on process.nextTick, and calls in
   * one window with one model, operation and argument shape go out as one batch.
   */
  #sameTickBatch(pending: PendingQuery): string | null {
    if (pending.transaction !== null || !BATCHED_OPERATIONS.has(pending.operation)) return null;
    if (this.#openTick === null) {
      const tick = this.#nextTick++;
      this.#openTick = tick;
      process.nextTick(() => { if (this.#openTick === tick) this.#openTick = null; });
    }
    if (pending.client !== "admin") return null;
    if (!isCompactable(pending.model, pending.args, countRelationLoads(pending.model, pending.args))) return null;
    return `${this.#openTick}|${pending.model}|${pending.operation}|${argumentShape(pending.args)}`;
  }

  /** Records the query, resolves its answer, settles its nested loads, then tells the observer. */
  async #send(pending: PendingQuery, resolve: () => unknown): Promise<unknown> {
    const { args, ...fields } = pending;
    const relationLoads = countRelationLoads(pending.model, args);
    const query: RecordedQuery = {
      ...fields,
      inInteractiveTransaction: pending.transaction !== null && pending.transaction.kind !== "batch",
      relationLoads,
      nestedLoads: relationLoads,
      sameTickBatch: this.#sameTickBatch(pending),
    };
    const index = this.queries.push(query) - 1;
    // A real reply arrives as I/O, after the dataloader's window has closed.
    // Answering on a microtask instead would merge calls awaited one after another.
    await new Promise((settle) => setImmediate(settle));
    const result = await resolve();
    // An unanswered call's empty result is the counter's guess, not data: count its loads in full.
    const nestedLoads = pending.answeredBy === "default" ? relationLoads : loadedRelations(pending.model, args, result);
    const settled: RecordedQuery = { ...query, nestedLoads };
    this.queries[index] = settled;
    this.observer?.({ query: settled, prismaModel: PRISMA_MODEL_BY_CLIENT_NAME.get(query.model), args, result });
    return result;
  }

  #modelDelegate(client: QueryClient, model: string, own: TransactionRef | null): Queryable {
    return Object.fromEntries(MODEL_OPERATIONS.map((operation) => [operation, (args?: unknown) => {
      const caller = captureCaller();
      return new LazyQuery((batch) => {
        const { answeredBy, resolve } = this.#answer(client, `${model}.${operation}`, args, () =>
          defaultResult(model, operation, args));
        return this.#send({ client, model, operation, transaction: own ?? batch, answeredBy, caller, args }, resolve);
      });
    }]));
  }

  #rawMethods(client: QueryClient, own: TransactionRef | null): Queryable {
    return Object.fromEntries(RAW_OPERATIONS.map((operation) => [operation, (first: unknown, ...rest: unknown[]) => {
      const caller = captureCaller();
      return new LazyQuery((batch) => {
        const empty = operation.startsWith("$queryRaw") ? [] : 0;
        const rawArgs = rawCallArguments(first, rest);
        const { answeredBy, resolve } = this.#answer(client, operation, rawArgs, () => empty);
        return this.#send({
          client, model: RAW_MODEL, operation, transaction: own ?? batch, answeredBy, caller, args: rawArgs,
        }, resolve);
      });
    }]));
  }

  #queryable(client: QueryClient, transaction: TransactionRef | null): Queryable {
    return {
      ...Object.fromEntries(
        MODEL_NAMES.map((model) => [model, this.#modelDelegate(client, model, transaction)]),
      ),
      ...this.#rawMethods(client, transaction),
    };
  }

  #open(client: QueryClient, kind: TransactionKind): TransactionRef {
    const transaction: RecordedTransaction = { id: this.#nextTransactionId++, kind, client };
    this.transactions.push(transaction);
    return { id: transaction.id, kind };
  }

  interactive<T>(client: QueryClient, kind: TransactionKind, work: (tx: Queryable) => Promise<T>): Promise<T> {
    return work(this.#queryable(client, this.#open(client, kind)));
  }

  async #batch(client: QueryClient, input: readonly unknown[]): Promise<unknown[]> {
    const transaction = this.#open(client, "batch");
    const results: unknown[] = [];
    for (const query of input) results.push(await (query instanceof LazyQuery ? query.runIn(transaction) : query));
    return results;
  }

  client(name: QueryClient): Queryable {
    return {
      ...this.#queryable(name, null),
      $transaction: async (input: unknown) => {
        if (isResolver(input)) return this.interactive(name, "interactive", async (tx) => input(tx));
        if (!Array.isArray(input)) throw new Error("$transaction expects an array of queries or a function.");
        return this.#batch(name, input);
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
      withAppTransaction: <T>(work: (tx: Queryable) => Promise<T>) =>
        recorder.interactive("app", "appTransaction", work),
      withAppReadTransaction: <T>(work: (tx: Queryable) => Promise<T>) =>
        recorder.interactive("app", "appTransaction", work),
    },
    queries: () => [...recorder.queries],
    transactions: () => [...recorder.transactions],
    async section(work) {
      const start = recorder.queries.length;
      const startTransactions = recorder.transactions.length;
      const value = await work();
      return {
        value,
        queries: recorder.queries.slice(start),
        transactions: recorder.transactions.slice(startTransactions),
      };
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
  const nestedFor = (client: QueryClient) =>
    queries.filter((query) => query.client === client).reduce((sum, query) => sum + query.nestedLoads, 0);
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
    appNestedLoads: nestedFor("app"),
    adminNestedLoads: nestedFor("admin"),
    byCaller,
  };
}

/** Round trips a lone app-client call pays: BEGIN, set_config, the query, COMMIT (`runWithContext`, src/lib/db.ts). */
export const APP_CALL_ROUND_TRIPS = 4;
/**
 * Statements `withAppTransaction` and `withAppReadTransaction` (src/lib/db.ts)
 * add around their queries: BEGIN, SET TRANSACTION ISOLATION LEVEL
 * (SERIALIZABLE or REPEATABLE READ; both pass a level, so the count is the
 * same; counted as its own statement, the larger reading), set_config, COMMIT.
 * Its queries run on the raw app client, so each is 1, not 4.
 */
export const APP_TRANSACTION_OVERHEAD = 4;
/** BEGIN and COMMIT around any other `$transaction`. */
export const TRANSACTION_OVERHEAD = 2;

export interface ClientCost {
  readonly calls: number;
  readonly nestedLoads: number;
  /** Statements that carry a query: calls, less same-tick merges, plus nested loads. */
  readonly statements: number;
  readonly roundTrips: number;
}

export interface RoundTripEstimate {
  readonly app: ClientCost;
  readonly admin: ClientCost;
}

/** Round trips a call's own query costs, before nested loads and transaction overhead. */
function callRoundTrips(query: RecordedQuery): number {
  if (query.client === "admin") return 1;
  // Inside withAppTransaction the raw client runs the query bare. Inside
  // prisma.$transaction the RLS extension still wraps each call in its own
  // batch; whether Prisma nests or merges that batch is unverified here, so
  // the call keeps its full wrapper cost, the larger reading.
  return query.transaction?.kind === "appTransaction" ? 1 : APP_CALL_ROUND_TRIPS;
}

function costFor(
  client: QueryClient,
  queries: readonly RecordedQuery[],
  transactions: readonly RecordedTransaction[],
): ClientCost {
  const own = queries.filter((query) => query.client === client);
  const nestedLoads = own.reduce((sum, query) => sum + query.nestedLoads, 0);
  const seenBatches = new Set<string>();
  let sent = 0;
  let roundTrips = 0;
  for (const query of own) {
    if (query.sameTickBatch !== null && seenBatches.has(query.sameTickBatch)) continue;
    if (query.sameTickBatch !== null) seenBatches.add(query.sameTickBatch);
    sent += 1;
    roundTrips += callRoundTrips(query);
  }
  const overhead = transactions
    .filter((transaction) => transaction.client === client)
    .reduce((sum, transaction) =>
      sum + (transaction.kind === "appTransaction" ? APP_TRANSACTION_OVERHEAD : TRANSACTION_OVERHEAD), 0);
  return { calls: own.length, nestedLoads, statements: sent + nestedLoads, roundTrips: roundTrips + nestedLoads + overhead };
}

/**
 * Estimated round trips to Postgres, per client. The rules:
 * - an app-client call alone: 4 (BEGIN, set_config, query, COMMIT), because
 *   `runWithContext` in src/lib/db.ts sends `$transaction([set_config, query])`
 *   for every call; each call is its own transaction, so Prisma never batches
 *   two app-client calls together.
 * - an admin-client call: 1. Admin findUnique / findUniqueOrThrow calls outside
 *   a transaction, issued before process.nextTick, with the same model,
 *   operation and argument shape, a where of one `@id` or `@unique` field
 *   holding a string or number, and no nested loads, count 1 together
 *   (`isMergeableWhere` in src/lib/readiness/admin-batching.ts):
 *   Prisma 6.19's DataLoader (node_modules/@prisma/client/runtime/library.js,
 *   `batchBy` -> `Zl`, `dispatchBatches`) sends them as one `requestBatch`, and
 *   the engine compacts such a batch into one select.
 * - each nested relation load: 1 more, on the client of the call that loads it,
 *   counted only when the level above returned rows.
 * - withAppTransaction: 4 around its queries, each query 1.
 * - any other `$transaction`, either form: 2 (BEGIN, COMMIT) around its queries,
 *   each costed as it would be alone.
 */
export function estimateRoundTrips(
  queries: readonly RecordedQuery[],
  transactions: readonly RecordedTransaction[],
): RoundTripEstimate {
  return { app: costFor("app", queries, transactions), admin: costFor("admin", queries, transactions) };
}

function queryName(query: RecordedQuery): string {
  return query.model === RAW_MODEL ? query.operation : `${query.model}.${query.operation}`;
}

function describeQuery(query: RecordedQuery): string {
  const name = queryName(query);
  const relations = query.nestedLoads > 0 ? `(+${query.nestedLoads} nested)` : "";
  const skipped = query.relationLoads > query.nestedLoads ? `(${query.relationLoads - query.nestedLoads} nested not sent: no rows)` : "";
  const transaction = query.transaction ? `[tx${query.transaction.id}]` : "";
  const batch = query.sameTickBatch ? "[batched]" : "";
  return `${name}:${query.caller.line}${relations}${skipped}${transaction}${batch}`;
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
    `${label}: app ${summary.app}, admin ${summary.admin}, ` +
      `nested relation loads app ${summary.appNestedLoads}, admin ${summary.adminNestedLoads}`,
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
  readonly transactions: readonly RecordedTransaction[];
  /** Queries counted by reading the source because the test could not run them. */
  readonly readNotExecuted: number;
}

/** The line `scripts/readiness/query-count.mjs` parses. Change both together. */
export function queryCountLine(report: QueryCountReport): string {
  const { app, admin } = estimateRoundTrips(report.queries, report.transactions);
  return [
    "QUERY_COUNT",
    `path=${report.path}`,
    `cache=${report.cache}`,
    `app=${app.calls}`,
    `admin=${admin.calls}`,
    `appNested=${app.nestedLoads}`,
    `adminNested=${admin.nestedLoads}`,
    `appStatements=${app.statements}`,
    `adminStatements=${admin.statements}`,
    `appRoundTrips=${app.roundTrips}`,
    `adminRoundTrips=${admin.roundTrips}`,
    `read=${report.readNotExecuted}`,
  ].join(" ");
}
