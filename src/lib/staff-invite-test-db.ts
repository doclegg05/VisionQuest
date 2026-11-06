/**
 * Test-only: an in-memory stand-in for Postgres that the staff-invite tests
 * hand to `mock.module("@/lib/db", ...)`. Only `@/lib/db` is mocked: org-roles,
 * region and the modules under test run for real (MEMORY.md Known Issues: a
 * mocked predicate hides the bug it should catch).
 *
 * Every fake call yields to the event loop first, so two requests started
 * together interleave the way two requests would. `updateMany` checks and
 * writes in one synchronous step, like a row lock. A writing transaction that
 * throws is rolled back through an undo log.
 */

export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface Table {
  rows: Row[];
  unique: string[];
}

export interface FakeState {
  staffInvite: Table;
  student: Table;
  regionCoordinator: Table;
  regionInstructor: Table;
  region: Table;
  auditLog: Table;
}

export type TableName = keyof FakeState;

const TABLES: TableName[] = ["staffInvite", "student", "regionCoordinator", "regionInstructor", "region", "auditLog"];

function emptyState(): FakeState {
  return {
    staffInvite: { rows: [], unique: ["id", "tokenHash"] },
    student: { rows: [], unique: ["id", "studentId", "email"] },
    regionCoordinator: { rows: [], unique: [] },
    regionInstructor: { rows: [], unique: [] },
    region: { rows: [], unique: ["id"] },
    auditLog: { rows: [], unique: [] },
  };
}

/** Postgres returns these for a column nobody set. */
const INVITE_DEFAULTS: Row = {
  acceptedAt: null,
  acceptedById: null,
  revokedAt: null,
  deliveredByEmail: false,
  codeHash: null,
  codeExpiresAt: null,
  codeAttempts: 0,
};

/** Foreign keys the accept path writes through: child table, column, parent table. */
const FOREIGN_KEYS: Array<[TableName, string, TableName]> = [
  ["regionCoordinator", "regionId", "region"],
  ["regionInstructor", "regionId", "region"],
];

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date);
}

function compareBound(actual: unknown, bound: unknown, op: "gt" | "lt"): boolean {
  const a = actual instanceof Date ? actual.getTime() : actual;
  const b = bound instanceof Date ? bound.getTime() : bound;
  if (typeof a !== "number" || typeof b !== "number") return false;
  return op === "gt" ? a > b : a < b;
}

function matchesFilter(actual: unknown, expected: Record<string, unknown>): boolean {
  if ("in" in expected) return Array.isArray(expected.in) && expected.in.includes(actual);
  if ("gt" in expected) return compareBound(actual, expected.gt, "gt");
  if ("lt" in expected) return compareBound(actual, expected.lt, "lt");
  if ("startsWith" in expected) return typeof actual === "string" && actual.startsWith(String(expected.startsWith));
  if ("equals" in expected) {
    if (typeof actual !== "string") return false;
    const want = String(expected.equals);
    return expected.mode === "insensitive" ? actual.toLowerCase() === want.toLowerCase() : actual === want;
  }
  throw new Error(`fake db: unsupported filter ${JSON.stringify(expected)}`);
}

function matchesField(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (isPlainObject(expected)) return matchesFilter(actual, expected);
  return actual === expected;
}

function flattenWhere(where: Where): Where {
  const flat: Where = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes("_") && isPlainObject(value)) Object.assign(flat, value);
    else flat[key] = value;
  }
  return flat;
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(flattenWhere(where)).every(([key, value]) => matchesField(row[key], value));
}

/** Apply `data` to a row, honouring Prisma's `{ increment: n }`. */
function applyData(row: Row, data: Row): Row {
  const next: Row = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (isPlainObject(value) && "increment" in value) {
      next[key] = Number(row[key] ?? 0) + Number(value.increment);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function createFakeDb() {
  const db: {
    state: FakeState;
    idCounter: number;
    transactions: number;
    beforeCreate: ((table: TableName) => void) | null;
  } = { state: emptyState(), idCounter: 0, transactions: 0, beforeCreate: null };

  function assertUnique(table: Table, candidate: Row, selfIndex: number): void {
    for (const key of table.unique) {
      const value = candidate[key];
      if (value === null || value === undefined) continue;
      const clash = table.rows.some((row, index) => index !== selfIndex && row[key] === value);
      // Prisma reports the clashing fields in meta.target.
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${key}`), { code: "P2002", meta: { target: [key] } });
      }
    }
  }

  function assertForeignKeys(name: TableName, row: Row): void {
    for (const [child, column, parent] of FOREIGN_KEYS) {
      if (child !== name || row[column] === null || row[column] === undefined) continue;
      if (!db.state[parent].rows.some((candidate) => candidate.id === row[column])) {
        throw Object.assign(new Error(`Foreign key constraint failed on ${column}`), { code: "P2003" });
      }
    }
  }

  function makeDelegate(name: TableName, undo: Array<() => void> | null) {
    const table = () => db.state[name];
    const record = (restore: () => void) => undo?.push(restore);
    const setRows = (rows: Row[]) => {
      db.state[name] = { ...table(), rows };
    };

    return {
      async create(args: { data: Row }) {
        await tick();
        db.beforeCreate?.(name);
        db.idCounter += 1;
        const defaults = name === "staffInvite" ? INVITE_DEFAULTS : {};
        const row: Row = { id: `${name}-${db.idCounter}`, createdAt: new Date(), ...defaults, ...args.data };
        assertUnique(table(), row, -1);
        assertForeignKeys(name, row);
        setRows([...table().rows, row]);
        record(() => setRows(table().rows.filter((r) => r !== row)));
        return row;
      },
      async findUnique(args: { where: Where }) {
        await tick();
        return table().rows.find((row) => matches(row, args.where)) ?? null;
      },
      async findFirst(args: { where: Where }) {
        await tick();
        return table().rows.find((row) => matches(row, args.where)) ?? null;
      },
      async findMany(args: { where?: Where }) {
        await tick();
        return table().rows.filter((row) => matches(row, args.where ?? {}));
      },
      async count(args: { where?: Where }) {
        await tick();
        return table().rows.filter((row) => matches(row, args.where ?? {})).length;
      },
      async updateMany(args: { where: Where; data: Row }) {
        await tick();
        const before = table().rows;
        const count = before.filter((row) => matches(row, args.where)).length;
        setRows(before.map((row) => (matches(row, args.where) ? applyData(row, args.data) : row)));
        record(() => setRows(before));
        return { count };
      },
      async update(args: { where: Where; data: Row }) {
        await tick();
        const before = table().rows;
        const index = before.findIndex((row) => matches(row, args.where));
        if (index < 0) throw Object.assign(new Error("Record not found"), { code: "P2025" });
        const updated = applyData(before[index], args.data);
        assertUnique(table(), updated, index);
        setRows(before.map((row, i) => (i === index ? updated : row)));
        record(() => setRows(before));
        return updated;
      },
    };
  }

  function makeClient(undo: Array<() => void> | null) {
    return Object.fromEntries(TABLES.map((name) => [name, makeDelegate(name, undo)]));
  }

  const client = {
    ...makeClient(null),
    async $transaction<T>(fn: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> {
      db.transactions += 1;
      const undo: Array<() => void> = [];
      try {
        return await fn(makeClient(undo));
      } catch (error) {
        for (const restore of [...undo].reverse()) restore();
        throw error;
      }
    },
  };

  return {
    client,
    get state(): FakeState {
      return db.state;
    },
    get transactions(): number {
      return db.transactions;
    },
    reset(): void {
      db.state = emptyState();
      db.transactions = 0;
      db.beforeCreate = null;
    },
    /** Run `hook` just before every `create`, e.g. to delete a parent row mid-transaction. */
    beforeCreate(hook: (table: TableName) => void): void {
      db.beforeCreate = hook;
    },
    seed(name: TableName, row: Row): void {
      db.state[name] = { ...db.state[name], rows: [...db.state[name].rows, row] };
    },
    patch(name: TableName, id: string, patch: Row): void {
      db.state[name] = {
        ...db.state[name],
        rows: db.state[name].rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
    },
    remove(name: TableName, id: string): void {
      db.state[name] = { ...db.state[name], rows: db.state[name].rows.filter((r) => r.id !== id) };
    },
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
