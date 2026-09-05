/* eslint-disable @typescript-eslint/no-explicit-any -- a Prisma-shaped stand-in has to accept many unrelated call signatures at once. */
/**
 * An in-memory, Prisma-shaped store for the nudge benchmarks.
 *
 * Both rule-level nudge suites (`nudge-consent`, `nudge-attribution`) drive the
 * REAL production modules — `src/lib/nudges/schedule.ts`, `sms-policy.ts` and
 * `replies.ts` — with this in place of `@/lib/db`. That is the whole point:
 * a benchmark that re-implemented the consent decision or the reply matcher
 * would measure the copy, and the copy cannot regress with the app.
 *
 * Two properties make it trustworthy enough to gate on:
 *
 *  1. **The `where` matcher is total or it throws.** Every filter clause the
 *     production query writes is either honoured or raises. A stand-in that
 *     silently ignored `smsRevokedAt` or `sentAt: { gte }` would make the very
 *     invariants these suites exist to pin pass for free — the failure mode
 *     is a benchmark that is green because it is blind. `orderBy` and `take`
 *     are applied in Postgres's order (filter, sort, limit) for the same
 *     reason: the roster ceiling only means something if the cap comes last.
 *
 *  2. **The transaction is a real serialisation point.** `$transaction`
 *     hands back a client that shares this store, and the two advisory-lock
 *     forms behave the way `pg_*_xact_lock` behaves: the run lock is held for
 *     the life of the transaction and a concurrent taker is refused, and the
 *     per-recipient lock queues. Without that the daily cap looks safe here
 *     while racing in production.
 *
 * It is NOT a Prisma emulator. It knows only the models and the clauses these
 * three modules use, and every gap is a throw rather than a default.
 */

// ---------------------------------------------------------------------------
// Row shapes — only the columns the nudge modules read or write.
// ---------------------------------------------------------------------------

export interface StudentRow {
  id: string;
  role: string;
  isActive: boolean;
}

export interface EnrollmentRow {
  studentId: string;
  classId: string;
  status: string;
}

export interface PreferenceRow {
  id: string;
  studentId: string;
  channel: string;
  destination: string | null;
  enabled: boolean;
  smsConsentAt: Date | null;
  smsRevokedAt: Date | null;
}

export interface ConnectionRow {
  id: string;
  studentId: string;
  status: string;
  sentAt: Date | null;
  statusChangedAt: Date;
  employerViewedAt: Date | null;
  interviewAppointmentId: string | null;
  employer: { name: string } | null;
  jobLead: { title: string } | null;
  interviewAppointment: {
    startsAt: Date;
    status: string;
    locationLabel: string | null;
    locationType: string | null;
  } | null;
  closedReason?: string | null;
}

export interface ConnectionEventRow {
  connectionId: string;
  toStatus: string | null;
  note: string | null;
  at: Date;
}

export interface OutboundRow {
  id: string;
  channel: string;
  toKind: string;
  toId: string;
  templateKey: string;
  body: string;
  status: string;
  connectionId: string | null;
  expectsReply: string | null;
  sentAt: Date;
  repliedAt: Date | null;
}

export interface AlertRow {
  studentId: string;
  alertKey: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export interface SavedJobRow {
  id: string;
  studentId: string;
  status: string;
  appliedAt: Date | null;
  jobListing: { title: string } | null;
}

export interface LeadRow {
  id: string;
  status: string;
  classId: string | null;
  createdAt: Date;
}

export interface NudgeStoreSeed {
  students?: StudentRow[];
  enrollments?: EnrollmentRow[];
  preferences?: PreferenceRow[];
  connections?: ConnectionRow[];
  connectionEvents?: ConnectionEventRow[];
  outbound?: OutboundRow[];
  alerts?: AlertRow[];
  savedJobs?: SavedJobRow[];
  leads?: LeadRow[];
}

// ---------------------------------------------------------------------------
// The `where` matcher
// ---------------------------------------------------------------------------

function scalarEquals(value: unknown, operand: unknown): boolean {
  if (value instanceof Date && operand instanceof Date) {
    return value.getTime() === operand.getTime();
  }
  return value === operand;
}

function comparable(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  throw new Error(`cannot order-compare ${JSON.stringify(value)}`);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * One field against one condition. An unknown operator throws, because the
 * alternative — treating it as satisfied — turns a filter the production query
 * relies on into a no-op and the suite that depends on it into decoration.
 */
export function matchField(value: unknown, condition: unknown): boolean {
  if (condition === null) return !isPresent(value);
  if (condition instanceof Date || typeof condition !== "object") {
    return scalarEquals(value, condition);
  }
  for (const [operator, operand] of Object.entries(condition as Record<string, unknown>)) {
    switch (operator) {
      case "equals":
        if (!scalarEquals(value, operand)) return false;
        break;
      case "in":
        if (!(operand as unknown[]).some((entry) => scalarEquals(value, entry))) return false;
        break;
      case "notIn":
        if ((operand as unknown[]).some((entry) => scalarEquals(value, entry))) return false;
        break;
      case "not":
        if (operand === null) {
          if (!isPresent(value)) return false;
        } else if (scalarEquals(value, operand)) {
          return false;
        }
        break;
      case "gte":
        if (!isPresent(value) || comparable(value) < comparable(operand)) return false;
        break;
      case "gt":
        if (!isPresent(value) || comparable(value) <= comparable(operand)) return false;
        break;
      case "lte":
        if (!isPresent(value) || comparable(value) > comparable(operand)) return false;
        break;
      case "lt":
        if (!isPresent(value) || comparable(value) >= comparable(operand)) return false;
        break;
      case "startsWith":
        if (typeof value !== "string" || !value.startsWith(String(operand))) return false;
        break;
      default:
        throw new Error(`nudge-store: unsupported filter operator "${operator}"`);
    }
  }
  return true;
}

export type RelationResolvers = Record<string, (row: any) => unknown>;

/** A whole `where` object, including `OR`/`AND` and declared relations. */
export function matchesWhere(
  row: any,
  where: Record<string, unknown> | undefined,
  relations: RelationResolvers = {},
): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "OR") {
      if (!(condition as any[]).some((clause) => matchesWhere(row, clause, relations))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(condition as any[]).every((clause) => matchesWhere(row, clause, relations))) return false;
      continue;
    }
    if (key in relations) {
      const related = relations[key](row);
      if (related === null || related === undefined) return false;
      if (!matchesWhere(related, condition as Record<string, unknown>, {})) return false;
      continue;
    }
    if (!matchField(row[key], condition)) return false;
  }
  return true;
}

/** Filter, then sort, then limit — Postgres's order, so a `take` bites last. */
function query<T>(
  rows: T[],
  args: { where?: any; orderBy?: any; take?: number } | undefined,
  relations: RelationResolvers = {},
): T[] {
  let found = rows.filter((row) => matchesWhere(row, args?.where, relations));
  const orderBy = args?.orderBy;
  if (orderBy) {
    const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<Record<string, string>>;
    found = found.slice().sort((left: any, right: any) => {
      for (const clause of clauses) {
        for (const [field, direction] of Object.entries(clause)) {
          const a = left[field];
          const b = right[field];
          if (a === b) continue;
          const order =
            a instanceof Date && b instanceof Date
              ? a.getTime() - b.getTime()
              : String(a) < String(b)
                ? -1
                : 1;
          if (order !== 0) return direction === "desc" ? -order : order;
        }
      }
      return 0;
    });
  }
  return typeof args?.take === "number" ? found.slice(0, args.take) : found;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface NudgeStore {
  data: Required<NudgeStoreSeed>;
  /** Every SMS body handed to the (stubbed) sender, newest last. */
  delivered: Array<{ studentId: string; templateKey: string; destination: string | null }>;
  /** Student ids each per-student RLS context was opened for. */
  rlsContexts: string[];
  /** Set true while a run-lock transaction is open. */
  runLockHeld: boolean;
  /** Every `spokesEmploymentFollowUp` write attempted — must stay empty. */
  followUpWrites: unknown[];
  prismaAdmin: any;
  prisma: any;
  nextId: (prefix: string) => string;
}

export function createNudgeStore(seed: NudgeStoreSeed = {}): NudgeStore {
  const data: Required<NudgeStoreSeed> = {
    students: [...(seed.students ?? [])],
    enrollments: [...(seed.enrollments ?? [])],
    preferences: [...(seed.preferences ?? [])],
    connections: [...(seed.connections ?? [])],
    connectionEvents: [...(seed.connectionEvents ?? [])],
    outbound: [...(seed.outbound ?? [])],
    alerts: [...(seed.alerts ?? [])],
    savedJobs: [...(seed.savedJobs ?? [])],
    leads: [...(seed.leads ?? [])],
  };

  let counter = 0;
  const nextId = (prefix: string) => {
    counter += 1;
    return `${prefix}${String(counter).padStart(6, "0")}`;
  };

  const studentOf = (row: { studentId: string }) =>
    data.students.find((student) => student.id === row.studentId) ?? null;
  const studentRelation: RelationResolvers = { student: studentOf };

  const store: NudgeStore = {
    data,
    delivered: [],
    rlsContexts: [],
    runLockHeld: false,
    followUpWrites: [],
    prismaAdmin: null,
    prisma: null,
    nextId,
  };

  const outboundModel = {
    findMany: async (args: any) => query(data.outbound, args),
    findFirst: async (args: any) => query(data.outbound, { ...args, take: 1 })[0] ?? null,
    count: async (args: any) => query(data.outbound, args).length,
    create: async (args: any) => {
      const row: OutboundRow = {
        id: nextId("om"),
        channel: args.data.channel,
        toKind: args.data.toKind,
        toId: args.data.toId,
        templateKey: args.data.templateKey,
        body: args.data.body,
        status: args.data.status,
        connectionId: args.data.connectionId ?? null,
        expectsReply: args.data.expectsReply ?? null,
        sentAt: args.data.sentAt,
        repliedAt: null,
      };
      data.outbound.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = data.outbound.find((entry) => entry.id === args.where.id);
      if (!row) throw new Error(`nudge-store: no OutboundMessage ${args.where.id}`);
      Object.assign(row, args.data);
      return row;
    },
    updateMany: async (args: any) => {
      const rows = query(data.outbound, args);
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
  };

  const alertModel = {
    findMany: async (args: any) => query(data.alerts, args),
    upsert: async (args: any) => {
      const existing = data.alerts.find((row) => row.alertKey === args.where.alertKey);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const row: AlertRow = { resolvedAt: null, ...args.create } as AlertRow;
      data.alerts.push(row);
      return row;
    },
    updateMany: async (args: any) => {
      const rows = query(data.alerts, args);
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
  };

  const savedJobModel = {
    findMany: async (args: any) => query(data.savedJobs, args, studentRelation),
    findUnique: async (args: any) =>
      data.savedJobs.find((row) => row.id === args.where.id) ?? null,
    update: async (args: any) => {
      const row = data.savedJobs.find((entry) => entry.id === args.where.id);
      if (!row) throw new Error(`nudge-store: no StudentSavedJob ${args.where.id}`);
      Object.assign(row, args.data);
      return row;
    },
  };

  const preferenceModel = {
    findFirst: async (args: any) => query(data.preferences, { ...args, take: 1 })[0] ?? null,
    findMany: async (args: any) => query(data.preferences, args),
    findUnique: async (args: any) => {
      const key = args.where.studentId_channel;
      return (
        data.preferences.find(
          (row) => row.studentId === key.studentId && row.channel === key.channel,
        ) ?? null
      );
    },
    update: async (args: any) => {
      const row = data.preferences.find((entry) => entry.id === args.where.id);
      if (!row) throw new Error(`nudge-store: no NotificationPreference ${args.where.id}`);
      Object.assign(row, args.data);
      return row;
    },
    updateMany: async (args: any) => {
      const rows = query(data.preferences, args);
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
  };

  const baseClient = {
    connection: {
      findMany: async (args: any) => query(data.connections, args, studentRelation),
      findUnique: async (args: any) =>
        data.connections.find((row) => row.id === args.where.id) ?? null,
      updateMany: async (args: any) => {
        const rows = query(data.connections, args);
        for (const row of rows) Object.assign(row, args.data);
        return { count: rows.length };
      },
    },
    connectionEvent: {
      findMany: async (args: any) => query(data.connectionEvents, args),
      create: async (args: any) => {
        const row: ConnectionEventRow = {
          connectionId: args.data.connectionId,
          toStatus: args.data.toStatus ?? null,
          note: args.data.note ?? null,
          at: args.data.at ?? new Date(),
        };
        data.connectionEvents.push(row);
        return row;
      },
    },
    outboundMessage: outboundModel,
    studentAlert: alertModel,
    studentSavedJob: savedJobModel,
    studentClassEnrollment: {
      findMany: async (args: any) => query(data.enrollments, args, studentRelation),
    },
    jobLead: { findMany: async (args: any) => query(data.leads, args) },
    notificationPreference: preferenceModel,
    spokesEmploymentFollowUp: {
      // Never legitimately called from the nudge path — the 2026-09-05 decision
      // is that an SMS "Y" moves the Connect funnel and raises a staff alert,
      // and never writes the grant record. Recorded rather than thrown so the
      // benchmark can report the violation as a number instead of a crash.
      upsert: async (args: any) => {
        store.followUpWrites.push(args);
        return { id: "fu_never" };
      },
      create: async (args: any) => {
        store.followUpWrites.push(args);
        return { id: "fu_never" };
      },
    },
  };

  /**
   * `pg_advisory_xact_lock(1, …)` — the per-recipient send lock. Blocking, so
   * the model here is a promise chain per key: a second caller for the same
   * student waits for the first transaction to end, which is what makes the
   * "count then insert" pair atomic and the daily cap real under concurrency.
   */
  const sendLockTails = new Map<string, Promise<void>>();

  const makeTransactionClient = (release: { onEnd: Array<() => void> }) => ({
    ...baseClient,
    $queryRaw: async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = strings.raw.join("?");
      if (sql.includes("pg_try_advisory_xact_lock")) {
        if (store.runLockHeld) return [{ locked: false }];
        store.runLockHeld = true;
        release.onEnd.push(() => {
          store.runLockHeld = false;
        });
        return [{ locked: true }];
      }
      throw new Error(`nudge-store: unexpected $queryRaw in a transaction: ${sql}`);
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.raw.join("?");
      if (!sql.includes("pg_advisory_xact_lock")) {
        throw new Error(`nudge-store: unexpected $executeRaw: ${sql}`);
      }
      const key = String(values[values.length - 1]);
      const previous = sendLockTails.get(key) ?? Promise.resolve();
      let signalEnd: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        signalEnd = resolve;
      });
      sendLockTails.set(
        key,
        previous.then(() => held),
      );
      await previous;
      release.onEnd.push(signalEnd);
      return 1;
    },
  });

  store.prismaAdmin = {
    ...baseClient,
    $queryRaw: async (strings: TemplateStringsArray) => {
      // The run lock is transaction-scoped, so nothing should ever reach the
      // CLIENT-level raw path. A statement here is what a leaked session-level
      // lock would look like, and the 2026-09-05 decision log says why that is
      // unusable through a pooler.
      throw new Error(
        `nudge-store: a raw statement ran outside a transaction: ${strings.raw.join("?")}`,
      );
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const release = { onEnd: [] as Array<() => void> };
      try {
        return await fn(makeTransactionClient(release));
      } finally {
        // COMMIT or ROLLBACK: either way every xact-scoped lock is gone, with
        // no separate unlock statement to route onto the wrong connection.
        for (const end of release.onEnd) end();
      }
    },
  };

  // The app client. Under real RLS these are the student's own rows; here the
  // separation exists so a suite can assert every per-student write went
  // through withStudentRlsContext rather than the admin client.
  store.prisma = baseClient;

  return store;
}
