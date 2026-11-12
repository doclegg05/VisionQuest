/**
 * An in-memory stand-in for the two Prisma clients, used only by
 * auth.session-events.test.ts. It models just enough of the Student table for
 * the real password, status, offboarding and promotion code to run against it.
 *
 * Two things about it are deliberate:
 *
 *   - A write is not visible to other readers until it commits. A write made
 *     inside `$transaction(async (tx) => ...)` commits when the callback
 *     returns, as in Postgres, and not when the statement runs.
 *   - `beforeNextCommit` runs a callback at the last moment before a write
 *     commits. The test uses it to land a second request while the write is
 *     still on its way, which is what shows whether the code dropped the
 *     cached session row AFTER its write committed or too early.
 *
 * Authorization is not modelled: a relation filter such as "in a class this
 * teacher instructs" matches every row. Those rules have their own tests.
 */

export interface AccountRow {
  id: string;
  studentId: string;
  email: string | null;
  displayName: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  demoAccount: string | null;
  mustChangePassword: boolean;
  passwordHash: string | null;
  mfaEnabled: boolean;
  offboardedAt: Date | null;
  securityQuestionAnswers: ReadonlyArray<{ questionKey: string; answerHash: string }>;
  /** Columns a write may set that this file does not name. */
  [column: string]: unknown;
}

export interface ResetLinkRow {
  id: string;
  tokenHash: string;
  studentId: string;
  usedAt: Date | null;
  expiresAt: Date;
  [column: string]: unknown;
}

type Columns = Readonly<Record<string, unknown>>;

function isColumns(value: unknown): value is Columns {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function parts(value: unknown): Columns[] {
  return Array.isArray(value) ? value.filter(isColumns) : [];
}

/** Whether a row meets a Prisma `where`. Scalars, AND and OR only. */
function matches(row: Columns, where: Columns): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND") return parts(expected).every((part) => matches(row, part));
    if (key === "OR") return parts(expected).some((part) => matches(row, part));
    // A relation or comparison filter: not modelled, so it never excludes.
    if (isColumns(expected)) return true;
    return row[key] === expected;
  });
}

function isIncrement(value: unknown): value is { increment: number } {
  return isColumns(value) && typeof value.increment === "number";
}

/** The row after a Prisma `data` is applied. `{ increment }` is understood for the session version. */
function withChanges(row: AccountRow, data: Columns): AccountRow {
  const { sessionVersion, ...rest } = data;
  const next = isIncrement(sessionVersion)
    ? row.sessionVersion + sessionVersion.increment
    : typeof sessionVersion === "number"
      ? sessionVersion
      : row.sessionVersion;
  return { ...row, ...rest, sessionVersion: next };
}

/** Where account reads come from and where account writes go. */
interface AccountView {
  rows(): AccountRow[];
  put(row: AccountRow): Promise<void>;
}

interface WhereArgs {
  where: Columns;
}

interface WriteArgs extends WhereArgs {
  data: Columns;
}

function studentTable(view: AccountView) {
  const find = (where: Columns): AccountRow | null => view.rows().find((row) => matches(row, where)) ?? null;
  const copyOf = (row: AccountRow | null): AccountRow | null => (row ? { ...row } : null);
  return {
    findUnique: async ({ where }: WhereArgs) => copyOf(find(where)),
    findFirst: async ({ where }: WhereArgs) => copyOf(find(where)),
    update: async ({ where, data }: WriteArgs) => {
      const row = find(where);
      if (!row) throw Object.assign(new Error("No record was found for an update."), { code: "P2025" });
      const next = withChanges(row, data);
      await view.put(next);
      return { ...next };
    },
    updateMany: async ({ where, data }: WriteArgs) => {
      const hits = view.rows().filter((row) => matches(row, where));
      for (const row of hits) await view.put(withChanges(row, data));
      return { count: hits.length };
    },
  };
}

export function createFakeDatabase() {
  const accounts = new Map<string, AccountRow>();
  let resetLinks: ResetLinkRow[] = [];
  const revokedTokens = new Set<string>();
  let beforeCommit: (() => Promise<void>) | null = null;

  /** Runs the armed callback once, at the last moment before a write is visible. */
  async function lastMomentBeforeCommit(): Promise<void> {
    const land = beforeCommit;
    beforeCommit = null;
    if (land) await land();
  }

  function tables(view: AccountView) {
    return {
      student: studentTable(view),
      passwordResetToken: {
        findUnique: async ({ where }: WhereArgs) => {
          const link = resetLinks.find((row) => matches(row, where));
          if (!link) return null;
          const student = accounts.get(link.studentId);
          return { ...link, student: student ? { ...student } : null };
        },
        updateMany: async ({ where, data }: WriteArgs) => {
          const hits = resetLinks.filter((row) => matches(row, where));
          resetLinks = resetLinks.map((row) => (hits.includes(row) ? { ...row, ...data } : row));
          return { count: hits.length };
        },
        deleteMany: async ({ where }: WhereArgs) => {
          const kept = resetLinks.filter((row) => !matches(row, where));
          const count = resetLinks.length - kept.length;
          resetLinks = kept;
          return { count };
        },
      },
      sageConfirmationUse: {
        findUnique: async ({ where }: WhereArgs) =>
          typeof where.tokenHash === "string" && revokedTokens.has(where.tokenHash)
            ? { tokenHash: where.tokenHash }
            : null,
        create: async ({ data }: { data: { tokenHash: string } }) => {
          revokedTokens.add(data.tokenHash);
          return data;
        },
      },
    };
  }

  /** A write outside a transaction commits on its own. */
  const committed: AccountView = {
    rows: () => [...accounts.values()],
    put: async (row) => {
      await lastMomentBeforeCommit();
      accounts.set(row.id, row);
    },
  };

  async function transaction(work: unknown): Promise<unknown> {
    // The array form: each statement was issued on its own, above.
    if (Array.isArray(work)) return Promise.all(work);
    if (typeof work !== "function") throw new Error("This stand-in does not know that $transaction form");

    const written = new Map<string, AccountRow>();
    const inTransaction: AccountView = {
      rows: () => [...accounts.values()].map((row) => written.get(row.id) ?? row),
      put: async (row) => {
        written.set(row.id, row);
      },
    };
    const result: unknown = await work(tables(inTransaction));
    await lastMomentBeforeCommit();
    for (const row of written.values()) accounts.set(row.id, row);
    return result;
  }

  return {
    /** What both `prisma` and `prismaAdmin` are in the test. */
    client: { ...tables(committed), $transaction: transaction },
    addAccount(row: AccountRow): AccountRow {
      accounts.set(row.id, row);
      return row;
    },
    account(id: string): AccountRow {
      const row = accounts.get(id);
      if (!row) throw new Error("The test asked for an account it never made");
      return { ...row };
    },
    addResetLink(link: ResetLinkRow): void {
      resetLinks = [...resetLinks, link];
    },
    /** Arms `land` to run once, just before the next account write commits. */
    beforeNextCommit(land: () => Promise<void>): void {
      beforeCommit = land;
    },
  };
}
