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
 * in-process caches (session, permissions, system configuration, memory
 * profile) the first one filled. The cache invalidation `src/lib/db.ts` runs
 * on writes is mirrored here, so a write that would drop a cache still does.
 *
 * What they are not: production truth. No SQL is sent, so the count is of
 * Prisma calls, not statements or round trips. Real data can take branches
 * this fixture does not.
 *
 * Read, not executed: 0 queries. `src/proxy.ts` runs before the route and
 * issues none. Nothing on this path had to be counted by reading.
 *
 * The fixture's branches:
 * - a real student (not staff, not a demo account), session not revoked
 * - `ai_provider` is "local": the local-only path production is meant to run.
 *   That means the compact prompt tier, the hourly limit only (no daily
 *   limit, no token quota), and no situational snapshot. A cloud provider
 *   adds each of those, plus the de-identification identity read
 * - `SAGE_AGENT_MODE=readonly`, as `render.yaml` sets it; memory and
 *   retrieval enabled, as they are when their switches are unset
 * - an existing conversation in the "general" stage with two earlier
 *   messages, already past its one XP award. A new conversation adds the
 *   stage lookup and the conversation writes
 * - a message that is not small talk, names no form, carries no crisis
 *   signal and has no attachment, so retrieval and memory recall both run
 * - retrieval and memory find nothing, and most context reads find nothing
 *   (see "answered by default" in the output). A fuller record takes more
 *   branches after the reads, not more reads before the stream
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
  formatQueryBreakdown,
  queryCountLine,
  summarizeQueries,
  type RecordedQuery,
} from "@/lib/query-counter.test-support";
import { signToken } from "@/lib/session-token";

// Set to the measured value. A change to any of these is a change in what a
// chat turn costs before its first byte, and belongs in the diff that caused it.
// The 2026-11-10 review estimated 35 to 65 in total by reading. Measured for
// this fixture: 57 cold (35 + 22) and 33 warm (27 + 6).
const CHAT_SEND_APP_QUERIES_COLD = 35;
/** 13 of the 22 are system configuration reads, cached after the first turn. */
const CHAT_SEND_ADMIN_QUERIES_COLD = 22;
/** Cached between turns: the base chat context (6), the memory profile (1), the snippet list (1). */
const CHAT_SEND_APP_QUERIES_WARM = 27;
/** Four audit rows, the rate limit counter and the wager read, every turn. */
const CHAT_SEND_ADMIN_QUERIES_WARM = 6;
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
  "src/lib/chat/context.ts › (anonymous)": [6, 0],
  "src/lib/sage/wager-metrics.ts › getWagerHitRate": [0, 1],
  "src/lib/chat/conversation.ts › getConversationContext": [2, 0],
  "src/lib/sage/memory/profile.ts › (anonymous)": [1, 0],
  "src/lib/llm-usage.ts › logLlmCall": [2, 0],
  "src/lib/sage/memory/retrieve.ts › retrieveMemories": [1, 0],
  "src/lib/sage/hybrid-retrieval.ts › hybridSearchDocuments": [1, 0],
  "src/lib/sage/knowledge-base-server.ts › (anonymous)": [1, 0],
};

const STUDENT_ID = "stu-readiness-001";
const CONVERSATION_ID = "cm9readiness0000000000000a";
const NOW = new Date("2026-11-10T15:00:00.000Z");
const SESSION_COOKIE = "vq-session";
const LOCAL_AI_URL = "http://127.0.0.1:11434";
const ROUTE_FILE = "src/app/api/chat/send/route.ts";
/** A different message each turn, as in a real conversation: no turn reuses the other's query embedding. */
const COLD_MESSAGE = "What should I work on this week to get ready for interviews?";
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

/** The rate limiter's upsert must return its counter row; other raw reads find nothing. */
function rawRows(args: unknown): unknown[] {
  const sql = isRecord(args) && typeof args.sql === "string" ? args.sql : "";
  return sql.includes('"RateLimitEntry"')
    ? [{ count: 1, resetTime: new Date(NOW.getTime() + 60 * 60 * 1000) }]
    : [];
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
    id: CONVERSATION_ID, studentId: STUDENT_ID, stage: "general", title: "Interview prep",
    summary: null, summaryUpToMessageId: null, createdAt: NOW, updatedAt: NOW, messages: [...history].reverse(),
  },
  "conversation.findUnique": { summary: null, summaryUpToMessageId: null },
  "message.findMany": [...history].reverse(),
  // Student context.
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

/** Query counts at each moment the route constructed its response stream. */
const queryCountsAtStreamCreation: number[] = [];
const THIS_FILE = "chat-send-query-count.test.ts";
globalThis.ReadableStream = new Proxy(globalThis.ReadableStream, {
  construct(target, args, newTarget) {
    // The first frame outside this file is whoever wrote `new ReadableStream`.
    const frames = (new Error("stream constructed here").stack ?? "").split("\n").slice(1);
    const constructedBy = frames.find((frame) => !frame.includes(THIS_FILE)) ?? "";
    if (constructedBy.includes(ROUTE_FILE)) queryCountsAtStreamCreation.push(counter.queries().length);
    return Reflect.construct(target, args, newTarget);
  },
});

interface Turn {
  status: number;
  body: string;
  beforeStream: readonly RecordedQuery[];
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
    beforeStream: streamCreatedAt === undefined ? [] : all.slice(start, streamCreatedAt),
    afterStream: streamCreatedAt === undefined ? all.slice(start) : all.slice(streamCreatedAt),
  };
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
    t.diagnostic(queryCountLine({ path: "chat-send", cache: "cold", queries: cold.beforeStream, readNotExecuted: 0 }));

    assert.equal(summary.app, CHAT_SEND_APP_QUERIES_COLD);
    assert.equal(summary.admin, CHAT_SEND_ADMIN_QUERIES_COLD);
  });

  it("cold turn's queries come from the pinned functions", () => {
    assert.deepEqual(countsByFunction(cold.beforeStream), CHAT_SEND_COLD_BY_FUNCTION);
  });

  it("warm turn issues the pinned number of queries on each client before the stream", (t) => {
    for (const line of formatQueryBreakdown("M3 chat send, warm, before stream", warm.beforeStream).split("\n")) t.diagnostic(line);
    const summary = summarizeQueries(warm.beforeStream);
    t.diagnostic(queryCountLine({ path: "chat-send", cache: "warm", queries: warm.beforeStream, readNotExecuted: 0 }));

    assert.equal(summary.app, CHAT_SEND_APP_QUERIES_WARM);
    assert.equal(summary.admin, CHAT_SEND_ADMIN_QUERIES_WARM);
  });
});
