/**
 * Runs the REAL `@/lib/db` clients, extensions included, with no database:
 * only the query engine's transport is replaced. Every Prisma extension in
 * src/lib/db.ts (RLS context, chat-context write-through) runs as in
 * production; the engine answers from `answer` instead of Postgres.
 *
 * Use it where a mocked `@/lib/db` cannot prove the point: a mock replaces
 * the very extension under test.
 */
export interface EngineCall {
  readonly modelName: string | undefined;
  readonly action: string;
}

/** Answer for one call, or undefined for a call the test did not expect. */
export type EngineAnswer = (call: EngineCall) => unknown;

interface ProtocolQuery { modelName?: string; action: string }

function isProtocolQuery(value: unknown): value is ProtocolQuery {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "action") === "string";
}

function toCall(query: unknown): EngineCall {
  if (!isProtocolQuery(query)) throw new Error("The engine stub got a request it cannot read.");
  return { modelName: query.modelName, action: query.action };
}

/** The response key Prisma's JSON protocol reads: "createOneGoal", "aggregateGoal", "executeRaw". */
function responseFor(call: EngineCall, answer: EngineAnswer): { data: Record<string, unknown> } {
  const result = answer(call);
  if (result === undefined) throw new Error(`The engine stub has no answer for ${call.action} ${call.modelName ?? ""}.`);
  return { data: { [`${call.action}${call.modelName ?? ""}`]: result } };
}

/** Replaces `client`'s engine transport; returns the calls it receives. */
export function stubEngine(client: object, answer: EngineAnswer): EngineCall[] {
  const engine: unknown = Reflect.get(client, "_engine");
  if (typeof engine !== "object" || engine === null) throw new Error("This Prisma client has no engine to stub.");
  const calls: EngineCall[] = [];
  const respond = (query: unknown) => {
    const call = toCall(query);
    calls.push(call);
    return responseFor(call, answer);
  };
  Reflect.set(engine, "request", async (query: unknown) => respond(query));
  Reflect.set(engine, "requestBatch", async (queries: unknown[]) => queries.map(respond));
  Reflect.set(engine, "transaction", async (action: string) => (action === "start" ? { id: "stub-transaction" } : undefined));
  return calls;
}
