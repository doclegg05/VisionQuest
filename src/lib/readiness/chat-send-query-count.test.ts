/**
 * M3: database queries `POST /api/chat/send` issues before it creates the
 * response stream (`new ReadableStream` in `src/app/api/chat/send/route.ts`).
 *
 * What the numbers are: the Prisma calls the real route, its registry
 * middleware, session lookup, provider resolution, rate limiter, context
 * bundle, retrieval and memory code issue for the fixture below, with
 * `@/lib/db` replaced by a counter and the local AI host's HTTP API answered
 * by a stub. The count stops at the moment the route constructs its stream;
 * what the turn does after that is printed and not pinned. "Cold" is the first
 * turn in a new process. "Warm" is a second turn straight after, with the
 * in-process caches (session, permissions, system configuration, chat
 * context, memory profile, snippets) the first one filled. The cache
 * invalidation `src/lib/db.ts` runs on writes is mirrored here, so a write
 * that would drop a cache still does.
 *
 * What they are not: production truth. No SQL is sent. Calls are counted and
 * round trips estimated from them by `estimateRoundTrips` (rules in
 * src/lib/query-counter.test-support.ts). Real data can take branches this
 * fixture does not.
 *
 * Read, not executed: 0 queries. `src/proxy.ts` runs before the route and
 * issues none. Nothing on this path had to be counted by reading.
 *
 * The turn it models: an ordinary mid-conversation turn from a returning
 * student, in the stage the app most often stores for one. `Conversation.stage`
 * is only ever written by `determineStage` (src/lib/sage/stage.ts) or the two
 * requested stages in src/lib/chat/conversation.ts; "general", the stage the
 * first version of this fixture used, is a per-turn prompt override that is
 * never stored, and it skips four context loads a stored goal stage pays for.
 * The fixture is "weekly": a BHAG and a monthly goal exist, no weekly goal yet,
 * discovery complete, which is where a student sits for most of the goal
 * ladder. "weekly" is in all three stage sets in src/lib/chat/context.ts, so
 * the skill-gap, pathway and coaching-arc loads run, and the BHAG turns on the
 * career-thread resume check. "checkin", the end of the ladder, skips the
 * pathway load and would read cheaper.
 * - a real student (not staff, not a demo account), session not revoked
 * - `ai_provider` is "local": the local-only path production is meant to run.
 *   That means the compact prompt tier, the hourly limit only (no daily
 *   limit, no token quota), and no situational snapshot. A cloud provider
 *   adds each of those, plus the de-identification identity read
 * - `SAGE_AGENT_MODE=readonly`, as `render.yaml` sets it; memory and
 *   retrieval enabled, as they are when their switches are unset
 * - an existing conversation with two earlier messages, already past its one
 *   XP award. A new conversation adds the stage lookup and the conversation
 *   writes
 * - a message about planning the week: not small talk, no logistics words (so
 *   the prompt stage stays "weekly"), no form, no crisis signal, no attachment
 * - retrieval finds one program document and its best passage (so the passage
 *   read runs), and memory recall finds one memory. An active coaching arc
 *   exists, so none is created
 * - enrolled in one active class, and the in-progress certificate has one
 *   requirement row, so the class and template loads below them are counted
 * - reads the turn does not branch on are left empty (see "answered by
 *   default" in the output). A call left unanswered still counts its nested
 *   loads in full, and the last test fails on any such call not listed with
 *   a reason in CHAT_SEND_UNANSWERED_WITH_NESTED
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embedding-types";
import { applyChatContextWriteThrough, isChatContextWrite } from "@/lib/chat-context-write-through";
import { createInitialState } from "@/lib/progression/engine";
import {
  countsByFunction,
  createQueryCounter,
  estimateRoundTrips,
  formatQueryBreakdown,
  queryCountLine,
  summarizeQueries,
  type RecordedQuery,
  type RecordedTransaction,
} from "@/lib/query-counter.test-support";
import { unansweredLoadProblems, type UnansweredAllowances } from "./unanswered-loads";
import { signToken } from "@/lib/session-token";

// Set to the measured value. A change to any of these is a change in what a
// chat turn costs before its first byte, and belongs in the diff that caused it.
// The 2026-11-10 database review expected 39 to 44 app calls for a normal turn;
// this fixture measures 43.
const CHAT_SEND_APP_QUERIES_COLD = 43;
/** 13 of the 22 are system configuration reads, cached after the first turn; Prisma batches them into 4 statements. */
const CHAT_SEND_ADMIN_QUERIES_COLD = 22;
/** Cached between turns: the base chat context (6), the career-thread resume check, the memory profile, the snippet list, the skill gap (2), the pathway (3). */
const CHAT_SEND_APP_QUERIES_WARM = 29;
/** Four audit rows, the rate limit counter and the wager read, every turn. */
const CHAT_SEND_ADMIN_QUERIES_WARM = 6;
/** M3: app plus admin round trips, what `node scripts/readiness/query-count.mjs chat-send` prints. */
const CHAT_SEND_ROUND_TRIPS_COLD = 190;
const CHAT_SEND_ROUND_TRIPS_WARM = 127;
/** "file › function" -> [app, admin] for the cold turn. */
const CHAT_SEND_COLD_BY_FUNCTION: Record<string, [number, number]> = {
  "src/lib/session-revocation.ts › (anonymous)": [0, 1],
  "src/lib/auth.ts › (anonymous)": [0, 1],
  "src/lib/rbac.ts › hasSeededRolePermissions": [0, 1],
  "src/lib/audit.ts › logAuditEvent": [0, 4],
  "src/lib/system-config.ts › (anonymous)": [0, 13],
  "src/lib/rate-limit.ts › bumpCounter": [0, 1],
  "src/lib/chat/conversation.ts › getOrCreateConversation": [1, 0],
  "src/lib/chat/conversation.ts › saveMessage": [1, 0],
  "src/lib/program-type-server.ts › getStudentProgramType": [1, 0],
  "src/app/api/chat/send/route.ts › (anonymous)": [1, 0],
  "src/lib/progression/fetch-readiness-data.ts › fetchStudentReadinessData": [8, 0],
  "src/lib/sage/context-bundle.ts › assembleStudentContextBundle": [9, 0],
  "src/lib/chat/context.ts › (anonymous)": [7, 0],
  "src/lib/sage/wager-metrics.ts › getWagerHitRate": [0, 1],
  "src/lib/sage/coaching-arcs.ts › getOrCreateCoachingArc": [1, 0],
  "src/lib/sage/skill-gap.ts › analyzeSkillGaps": [2, 0],
  "src/lib/learning-pathway.ts › getLearningPathway": [2, 0],
  "src/lib/progression-edges.ts › loadPrerequisiteMap": [1, 0],
  "src/lib/chat/conversation.ts › getConversationContext": [2, 0],
  "src/lib/sage/memory/profile.ts › (anonymous)": [1, 0],
  "src/lib/llm-usage.ts › logLlmCall": [2, 0],
  "src/lib/sage/hybrid-retrieval.ts › hybridSearchDocuments": [1, 0],
  "src/lib/sage/memory/retrieve.ts › retrieveMemories": [1, 0],
  "src/lib/sage/knowledge-base-server.ts › (anonymous)": [1, 0],
  "src/lib/sage/hybrid-retrieval.ts › getBestChunks": [1, 0],
};
/**
 * Calls on the measured path that no fixture answers although they load a
 * nested relation, each with why. Anything else unanswered with a nested
 * relation fails the test below: the empty default hides what real rows load.
 */
const CHAT_SEND_UNANSWERED_WITH_NESTED: UnansweredAllowances = {};

const STUDENT_ID = "stu-readiness-001";
const CONVERSATION_ID = "cm9readiness0000000000000a";
const NOW = new Date("2026-11-10T15:00:00.000Z");
const SESSION_COOKIE = "vq-session";
const LOCAL_AI_URL = "http://127.0.0.1:11434";
const ROUTE_FILE = "src/app/api/chat/send/route.ts";
/** A different message each turn, as in a real conversation: no turn reuses the other's query embedding. */
const COLD_MESSAGE = "I want to plan my week so I keep moving toward my big goal.";
const WARM_MESSAGE = "Which of my goals should come first before Friday?";
const MODEL_REPLY = "Practice two answers out loud.";

process.env.JWT_SECRET = "readiness-query-count-jwt-secret-for-tests-only";
process.env.SAGE_AGENT_MODE = "readonly";
// Switches that steer this route. Cleared so a developer's shell cannot change the count.
for (const name of [
  "VQ_MAC_RELAY_ENABLED", "COHORT_DEMO_MODE", "COHORT_DEMO_LOCAL_ONLY",
  "VISIONQUEST_DISABLE_RATE_LIMITS", "SAGE_MEMORY_ENABLED", "SAGE_AGENT_ENABLED",
]) {
  delete process.env[name];
}
const sessionToken = signToken(STUDENT_ID, "student", 0);

const SYSTEM_CONFIG: Readonly<Record<string, string>> = {
  ai_provider: "local",
  ai_provider_url: LOCAL_AI_URL,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function systemConfigRow(args: unknown): { value: string } | null {
  const where = isRecord(args) && isRecord(args.where) ? args.where : {};
  const value = typeof where.key === "string" ? SYSTEM_CONFIG[where.key] : undefined;
  return value === undefined ? null : { value };
}

const DOCUMENT_ID = "doc-weekly-planning";

/**
 * Raw reads: the rate limiter's counter row, then what a returning student's
 * turn finds: one program document, its best passage, and one memory.
 */
function rawRows(args: unknown): unknown[] {
  const sql = isRecord(args) && typeof args.sql === "string" ? args.sql : "";
  if (sql.includes('"RateLimitEntry"')) return [{ count: 1, resetTime: new Date(NOW.getTime() + 60 * 60 * 1000) }];
  if (sql.includes("sage_hybrid_search")) {
    return [{
      id: DOCUMENT_ID, title: "Weekly planning guide", storage_key: "docs/weekly-planning.pdf",
      sageContextNote: "How SPOKES students plan a week of goals.", score: 0.03, semantic_rank: 1, fts_rank: 1, best_distance: 0.2,
    }];
  }
  if (sql.includes('"DocumentChunk"')) {
    return [{ documentId: DOCUMENT_ID, content: "Pick three tasks for the week.", pageNumber: 1, sectionTitle: null, distance: 0.2 }];
  }
  if (sql.includes('"SageMemory"')) {
    return [{
      id: "mem-1", kind: "fact", content: "Wants to work in an office.", category: "career",
      confidence: 0.9, validFrom: NOW, distance: 0.2,
    }];
  }
  return [];
}

/** The conversation's one XP award was made on an earlier turn. */
function alreadyAwarded(): never {
  throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
  });
}

const history = [
  { id: "msg-1", role: "user", content: "I want to get better at interviews.", createdAt: NOW },
  { id: "msg-2", role: "assistant", content: "Good goal. What job are you aiming for?", createdAt: NOW },
];

const counter = createQueryCounter({
  // Session and configuration (admin client).
  "admin:sageConfirmationUse.findUnique": null,
  "admin:student.findUnique": {
    id: STUDENT_ID, studentId: "readiness-student", displayName: "Riley Fixture",
    role: "student", sessionVersion: 0, isActive: true, demoAccount: null,
  },
  "admin:systemConfig.findUnique": systemConfigRow,
  $queryRaw: rawRows,
  // Conversation.
  "conversation.findFirst": {
    id: CONVERSATION_ID, studentId: STUDENT_ID, stage: "weekly", title: "Planning my week",
    summary: null, summaryUpToMessageId: null, createdAt: NOW, updatedAt: NOW, messages: [...history].reverse(),
  },
  "conversation.findUnique": { summary: null, summaryUpToMessageId: null },
  "message.findMany": [...history].reverse(),
  // Student context: a returning student with a big goal and a monthly goal, discovery done.
  "goal.findMany": [
    { id: "goal-bhag", level: "bhag", content: "Work as an office manager", status: "active", createdAt: NOW, updatedAt: NOW },
    { id: "goal-month", level: "monthly", content: "Earn the IC3 certification", status: "active", createdAt: NOW, updatedAt: NOW },
  ],
  "careerDiscovery.findUnique": {
    status: "complete", sageSummary: "Likes organizing and helping people.", topClusters: ["office-admin"],
    hollandCode: "CS", riasecScores: null, nationalClusters: [], workValues: [],
    transferableSkills: JSON.stringify([{ skill: "Scheduling", category: "organization" }]),
  },
  "certification.findMany": [
    {
      id: "cert-1", studentId: STUDENT_ID, certType: "ic3", status: "in_progress", startedAt: NOW, completedAt: null,
      // One requirement row, so the requirement level returns rows and its template load is counted.
      requirements: [{ completed: false, completedAt: null, verifiedAt: null, template: { required: true } }],
    },
  ],
  // An active enrollment, as an enrolled student has: the class load below it runs.
  "studentClassEnrollment.findFirst": { class: { programType: "spokes" } },
  "coachingArc.findUnique": {
    id: "arc-1", studentId: STUDENT_ID, arcType: "standard_6week", weekNumber: 3, status: "active", startedAt: NOW, milestones: [],
  },
  "resumeData.findUnique": { id: "resume-1" },
  "sageMemory.findMany": [{ id: "mem-1", kind: "fact", content: "Wants to work in an office.", category: "career", confidence: 0.9 }],
  "student.findUnique": { classroomConfirmedAt: NOW },
  "student.findUniqueOrThrow": {
    id: STUDENT_ID, displayName: "Riley Fixture", role: "student", classroomConfirmedAt: NOW, createdAt: NOW,
    spokesRecord: { birthDate: NOW },
  },
  "progression.findUnique": { state: JSON.stringify(createInitialState()), version: 0 },
  "orientationProgress.count": 3,
  "orientationItem.count": 8,
  // After the stream: keeps the turn's follow-up work on its ordinary path.
  "progressionEvent.create": alreadyAwarded,
});

// `src/lib/db.ts` drops a student's cached chat context when a watched model
// is written through the app client. The counter replaces that module, so the
// same rule is applied here.
counter.observe(({ query, prismaModel, args, result }) => {
  if (query.client !== "app" || !isChatContextWrite(prismaModel, query.operation)) return;
  applyChatContextWriteThrough(prismaModel, query.operation, args, result);
});

mock.module("@/lib/db", { exports: counter.dbModule });
mock.module("server-only", { exports: {} });
mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) => (name === SESSION_COOKIE ? { name, value: sessionToken } : undefined),
    }),
    headers: async () => new Headers(),
  },
});

/** Stands in for the local AI host: embeddings, a streamed reply, and JSON for the extractors. */
const fetchedUrls: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  fetchedUrls.push(url);
  const sent: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
  const request = isRecord(sent) ? sent : {};
  if (url === `${LOCAL_AI_URL}/api/embed`) {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    return Response.json({ embeddings: inputs.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01)) });
  }
  if (url === `${LOCAL_AI_URL}/api/chat`) {
    const done = { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 6 };
    if (request.stream === false) {
      return Response.json({ ...done, message: { role: "assistant", content: "{}" } });
    }
    const lines = [{ message: { role: "assistant", content: MODEL_REPLY }, done: false }, done];
    return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  throw new Error(`The chat route made an unexpected network call to ${url}`);
};

interface StreamMark {
  readonly queries: number;
  readonly transactions: number;
}
/** Query and transaction counts at each moment the route constructed its response stream. */
const queryCountsAtStreamCreation: StreamMark[] = [];
const THIS_FILE = "chat-send-query-count.test.ts";
globalThis.ReadableStream = new Proxy(globalThis.ReadableStream, {
  construct(target, args, newTarget) {
    // The first frame outside this file is whoever wrote `new ReadableStream`.
    const frames = (new Error("stream constructed here").stack ?? "").split("\n").slice(1);
    const constructedBy = frames.find((frame) => !frame.includes(THIS_FILE)) ?? "";
    if (constructedBy.includes(ROUTE_FILE)) {
      queryCountsAtStreamCreation.push({ queries: counter.queries().length, transactions: counter.transactions().length });
    }
    return Reflect.construct(target, args, newTarget);
  },
});

interface Turn {
  status: number;
  body: string;
  beforeStream: readonly RecordedQuery[];
  transactionsBeforeStream: readonly RecordedTransaction[];
  afterStream: readonly RecordedQuery[];
}

/** Waits until the turn's follow-up work has stopped issuing queries and requests. */
async function settle(): Promise<void> {
  let quietChecks = 0;
  let seen = -1;
  for (let check = 0; check < 400 && quietChecks < 5; check += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const activity = counter.queries().length + fetchedUrls.length;
    quietChecks = activity === seen ? quietChecks + 1 : 0;
    seen = activity;
  }
}

async function sendTurn(post: typeof import("@/app/api/chat/send/route").POST, message: string): Promise<Turn> {
  const start = counter.queries().length;
  const transactionStart = counter.transactions().length;
  const marksBefore = queryCountsAtStreamCreation.length;
  const response = await post(
    new NextRequest("http://localhost:3000/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationId: CONVERSATION_ID }),
    }),
    { params: Promise.resolve({}) },
  );
  const body = await response.text();
  await settle();
  const streamCreatedAt = queryCountsAtStreamCreation[marksBefore];
  const all = counter.queries();
  return {
    status: response.status,
    body,
    beforeStream: streamCreatedAt === undefined ? [] : all.slice(start, streamCreatedAt.queries),
    transactionsBeforeStream: streamCreatedAt === undefined
      ? []
      : counter.transactions().slice(transactionStart, streamCreatedAt.transactions),
    afterStream: streamCreatedAt === undefined ? all.slice(start) : all.slice(streamCreatedAt.queries),
  };
}

/** M3: app plus admin, what `node scripts/readiness/query-count.mjs chat-send` prints. */
function roundTrips(turn: Turn): number {
  const { app, admin } = estimateRoundTrips(turn.beforeStream, turn.transactionsBeforeStream);
  return app.roundTrips + admin.roundTrips;
}

let cold: Turn;
let warm: Turn;

before(async () => {
  const { POST } = await import("@/app/api/chat/send/route");
  cold = await sendTurn(POST, COLD_MESSAGE);
  warm = await sendTurn(POST, WARM_MESSAGE);
});

describe("M3: chat send query count before the response stream", () => {
  it("answers both turns with a streamed reply, so no step before the stream was skipped", () => {
    for (const turn of [cold, warm]) {
      assert.equal(turn.status, 200);
      assert.match(turn.body, new RegExp(MODEL_REPLY));
      assert.match(turn.body, /"done":true/);
    }
    assert.equal(queryCountsAtStreamCreation.length, 2, "each turn must construct the route's stream once");
    assert.ok(fetchedUrls.includes(`${LOCAL_AI_URL}/api/embed`), "retrieval did not run");
  });

  it("cold turn issues the pinned number of queries on each client before the stream", (t) => {
    for (const line of formatQueryBreakdown("M3 chat send, cold, before stream", cold.beforeStream).split("\n")) t.diagnostic(line);
    const after = summarizeQueries(cold.afterStream);
    t.diagnostic(`after the stream was created (not pinned): app ${after.app}, admin ${after.admin}`);
    const summary = summarizeQueries(cold.beforeStream);
    t.diagnostic(queryCountLine({
      path: "chat-send", cache: "cold", queries: cold.beforeStream, transactions: cold.transactionsBeforeStream, readNotExecuted: 0,
    }));

    assert.equal(summary.app, CHAT_SEND_APP_QUERIES_COLD);
    assert.equal(summary.admin, CHAT_SEND_ADMIN_QUERIES_COLD);
    assert.equal(roundTrips(cold), CHAT_SEND_ROUND_TRIPS_COLD);
  });

  it("cold turn's queries come from the pinned functions", () => {
    assert.deepEqual(countsByFunction(cold.beforeStream), CHAT_SEND_COLD_BY_FUNCTION);
  });

  it("warm turn issues the pinned number of queries on each client before the stream", (t) => {
    for (const line of formatQueryBreakdown("M3 chat send, warm, before stream", warm.beforeStream).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(warm.beforeStream);
    t.diagnostic(queryCountLine({
      path: "chat-send", cache: "warm", queries: warm.beforeStream, transactions: warm.transactionsBeforeStream, readNotExecuted: 0,
    }));

    assert.equal(summary.app, CHAT_SEND_APP_QUERIES_WARM);
    assert.equal(summary.admin, CHAT_SEND_ADMIN_QUERIES_WARM);
    assert.equal(roundTrips(warm), CHAT_SEND_ROUND_TRIPS_WARM);
  });

  it("answers every call that loads a nested relation, or names it with a reason", () => {
    assert.deepEqual(unansweredLoadProblems([...cold.beforeStream, ...warm.beforeStream], CHAT_SEND_UNANSWERED_WITH_NESTED), []);
  });
});
