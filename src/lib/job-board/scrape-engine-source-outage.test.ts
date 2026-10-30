/**
 * PR #248 review (Greptile P1, "Source outages report success"): fetchJson
 * turns an HTTP error or a network failure into `null`, and every adapter
 * turns that `null` into an empty, fulfilled job list. The engine therefore
 * recorded an outage as a source that answered with no jobs, the run stayed
 * "completed", and the weekly sweep never reported it.
 *
 * These cases drive REAL adapters through a stubbed `fetch`, not a throwing
 * mock adapter, because the bug lived in how a real adapter hides the failure.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { usajobsAdapter } from "./adapters/usajobs";
import { smartRecruitersAdapter } from "./adapters/smartrecruiters";

const ORIGINAL_FETCH = globalThis.fetch;

let configSources: string[] = [];
const sourceUpdates: Array<{ source: string; status?: unknown; error?: unknown }> = [];
const runFinishes: Array<{ status?: unknown; error?: unknown }> = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
        findUnique: async () => ({
          id: "config-alpha",
          region: "Charleston, WV",
          radius: 25,
          sources: configSources,
          localJobPriority: "prefer_local",
        }),
        update: async () => ({}),
      },
      jobScrapeRun: {
        create: async () => ({ id: "run-1" }),
        update: async () => ({}),
        updateMany: async (args: { data: { status?: unknown; error?: unknown } }) => {
          runFinishes.push({ status: args.data.status, error: args.data.error });
          return { count: 1 };
        },
      },
      jobScrapeSourceResult: {
        upsert: async () => ({}),
        update: async (args: {
          where: { scrapeRunId_source: { source: string } };
          data: { status?: unknown; error?: unknown };
        }) => {
          sourceUpdates.push({
            source: args.where.scrapeRunId_source.source,
            status: args.data.status,
            error: args.data.error,
          });
          return {};
        },
      },
      jobListing: {
        upsert: async () => ({}),
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
    },
  },
});

mock.module("./adapters/registry", {
  namedExports: { ALL_JOB_SOURCE_ADAPTERS: [usajobsAdapter, smartRecruitersAdapter] },
});

let runScrapeForConfig: typeof import("./scrape-engine").runScrapeForConfig;

beforeEach(async () => {
  ({ runScrapeForConfig } = await import("./scrape-engine"));
  process.env.USAJOBS_API_KEY = "test-usajobs-key";
  process.env.USAJOBS_EMAIL = "test@example.com";
  sourceUpdates.length = 0;
  runFinishes.length = 0;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_EMAIL;
});

function statusOf(source: string): unknown {
  return sourceUpdates.filter((update) => update.source === source && update.status).at(-1)?.status;
}

test("a source whose only request gets HTTP 503 is recorded as failed, and so is the run", async () => {
  configSources = ["usajobs"];
  globalThis.fetch = async () => new Response("Service Unavailable", { status: 503 });

  await runScrapeForConfig("config-alpha");

  assert.equal(statusOf("usajobs"), "failed");
  const failure = sourceUpdates.find((update) => update.source === "usajobs" && update.status === "failed");
  assert.match(String(failure?.error), /503/);
  assert.equal(runFinishes.at(-1)?.status, "failed");
});

test("a source whose request cannot connect is recorded as failed", async () => {
  configSources = ["usajobs"];
  globalThis.fetch = async () => {
    throw new Error("connection reset");
  };

  await runScrapeForConfig("config-alpha");

  assert.equal(statusOf("usajobs"), "failed");
  assert.equal(runFinishes.at(-1)?.status, "failed");
});

test("a source that answers 200 with no jobs is still a completed source", async () => {
  configSources = ["usajobs"];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ SearchResult: { SearchResultItems: [] } }), { status: 200 });

  await runScrapeForConfig("config-alpha");

  assert.equal(statusOf("usajobs"), "completed");
  assert.equal(runFinishes.at(-1)?.status, "completed");
});

test("a multi-board source with one dead board and one live board stays completed", async () => {
  configSources = ["smartrecruiters"];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("Not Found", { status: 404 })
      : new Response(JSON.stringify({ content: [] }), { status: 200 });
  };

  await runScrapeForConfig("config-alpha");

  assert.ok(calls > 1, "expected the adapter to try more than one board");
  assert.equal(statusOf("smartrecruiters"), "completed");
  const completed = sourceUpdates.find((update) => update.source === "smartrecruiters" && update.status === "completed");
  assert.match(String(completed?.error), /Partial results: 1 of 4 requests failed/);
  assert.equal(runFinishes.at(-1)?.status, "completed");
});
