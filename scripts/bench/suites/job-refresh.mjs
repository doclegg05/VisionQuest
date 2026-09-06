#!/usr/bin/env node
// =============================================================================
// job-refresh — does one broken job source ever delay or take down the sweep?
//
// The real refresh sweep (runScrapeForConfig in src/lib/job-board/
// scrape-engine.ts) fetches every configured adapter with Promise.allSettled
// and needs a live JobClassConfig row plus Prisma admin to run at all. This
// benchmark exercises the SAME concurrency shape — Promise.allSettled over
// the REAL adapters' fetchJobs() — without a database, so it stays gate-tier
// and in-process: no `requires`.
//
// Five real adapters (careeronestop, talroo, adzuna, jsearch, usajobs) are
// driven with a mocked `fetch`, matching VQ-R-019's rationale directly:
// jsearch is configured to HANG (its mocked response never resolves except
// through the AbortSignal the request itself carries — see fetchJson in
// ./adapters/shared.ts) and usajobs is configured to answer 500. Both go
// through fetchJson, which never throws on either failure mode — a timeout
// or a non-2xx response comes back as `null`, and the adapter turns that into
// `[]`. That hardening is exactly what this benchmark exists to catch a
// regression in: if a future change makes fetchJson (or an adapter) throw
// instead of degrading, or turns the sweep's Promise.allSettled into a
// Promise.all, the two bad adapters stop being isolated and drag the three
// good ones down with them.
//
// `AbortSignal.timeout` is monkey-patched to fire fast (fixture
// `fastTimeoutMs`, default 150ms) rather than the real 30s the production
// constant uses — the same technique jsearch.test.ts and adzuna.test.ts
// already use to exercise the abort codepath without a slow test. This suite
// measures the MECHANISM (a per-adapter timeout that does not block its
// siblings), not the literal 30_000ms constant.
//
//   node --import tsx scripts/bench/suites/job-refresh.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";

const ADAPTER_ENV = {
  careeronestop: { COS_USER_ID: "bench-user", COS_API_TOKEN: "bench-token" },
  talroo: { TALROO_API_KEY: "bench-key" },
  adzuna: { ADZUNA_APP_ID: "bench-id", ADZUNA_APP_KEY: "bench-key" },
  jsearch: { JSEARCH_API_KEY: "bench-key" },
  usajobs: { USAJOBS_API_KEY: "bench-key", USAJOBS_EMAIL: "bench@example.invalid" },
};

/** URL substring -> adapter name, so the fetch mock can route without parsing every adapter's query string. */
const ADAPTER_HOST = {
  careeronestop: "api.careeronestop.org",
  talroo: "api.talroo.com",
  adzuna: "api.adzuna.com",
  jsearch: "jsearch.p.rapidapi.com",
  usajobs: "data.usajobs.gov",
};

const ADAPTER_NAMES = Object.keys(ADAPTER_HOST);

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status) {
  return { ok: false, status, json: async () => ({}) };
}

/** Never resolves on its own — only the request's own AbortSignal ends it, exactly like jsearch.test.ts's timeout case. */
function hangingResponse(init) {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const rejectWithAbort = () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) {
      rejectWithAbort();
      return;
    }
    signal?.addEventListener("abort", rejectWithAbort);
  });
}

export function adapterNameForUrl(url) {
  return ADAPTER_NAMES.find((name) => url.includes(ADAPTER_HOST[name])) ?? null;
}

function buildFetchMock(fixtureAdapters) {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const name = adapterNameForUrl(url);
    if (!name) {
      throw new Error(`job-refresh fixture: mocked fetch saw an unrecognized URL: ${url}`);
    }
    const spec = fixtureAdapters[name];
    if (spec.behavior === "hangs") return hangingResponse(init);
    if (spec.behavior === "500") return errorResponse(500);
    return jsonResponse(spec.response);
  };
}

/** Races a promise against a deadline so a regressed timeout mechanism fails loudly instead of hanging the run forever. */
export function withDeadline(promise, ms, message) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function run(ctx) {
  const fixture = ctx.fixture;
  const region = fixture.region;
  const radiusMiles = fixture.radiusMiles;
  const fastTimeoutMs = fixture.fastTimeoutMs ?? 150;
  const raceDeadlineMs = fixture.raceDeadlineMs ?? 5000;

  const { careerOneStopAdapter } = await import("../../../src/lib/job-board/adapters/careeronestop.ts");
  const { talrooAdapter } = await import("../../../src/lib/job-board/adapters/talroo.ts");
  const { adzunaAdapter } = await import("../../../src/lib/job-board/adapters/adzuna.ts");
  const { jsearchAdapter } = await import("../../../src/lib/job-board/adapters/jsearch.ts");
  const { usajobsAdapter } = await import("../../../src/lib/job-board/adapters/usajobs.ts");

  const adapters = [
    { name: "careeronestop", adapter: careerOneStopAdapter },
    { name: "talroo", adapter: talrooAdapter },
    { name: "adzuna", adapter: adzunaAdapter },
    { name: "jsearch", adapter: jsearchAdapter },
    { name: "usajobs", adapter: usajobsAdapter },
  ];

  const originalFetch = globalThis.fetch;
  const originalAbortTimeout = AbortSignal.timeout;
  const originalEnv = {};
  for (const [, vars] of Object.entries(ADAPTER_ENV)) {
    for (const key of Object.keys(vars)) originalEnv[key] = process.env[key];
  }

  try {
    for (const vars of Object.values(ADAPTER_ENV)) {
      for (const [key, value] of Object.entries(vars)) process.env[key] = value;
    }
    globalThis.fetch = buildFetchMock(fixture.adapters);
    // Fires fast regardless of the real 30_000ms the adapters pass — see the
    // header comment. A fresh AbortController per call, exactly like the
    // hardened jsearch.test.ts/adzuna.test.ts precedent, so two concurrent
    // aborts (there is only one here, but a future adapter added to this
    // fixture might hang too) do not share one controller.
    AbortSignal.timeout = () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("bench fast-timeout")), fastTimeoutMs);
      return controller.signal;
    };

    const startedAt = performance.now();
    const sweep = withDeadline(
      Promise.allSettled(
        adapters.map(({ adapter }) => adapter.fetchJobs(region, radiusMiles)),
      ),
      raceDeadlineMs,
      `job-refresh: the sweep did not complete within ${raceDeadlineMs}ms — a per-adapter timeout ` +
        "regression (VQ-R-019) is the most likely cause: one adapter is blocking the whole " +
        "Promise.allSettled batch instead of failing on its own.",
    );
    const settled = await sweep;
    const sweepMs = Math.round(performance.now() - startedAt);

    const perAdapter = adapters.map(({ name }, index) => {
      const outcome = settled[index];
      const jobCount = outcome.status === "fulfilled" ? outcome.value.length : 0;
      return {
        name,
        settled: outcome.status,
        jobCount,
        // "Completed" for this benchmark's purposes means the sweep actually
        // delivered postings from that source — the two adapters configured
        // to fail (timeout, 500) are expected to hand back zero jobs via
        // fetchJson's null-on-failure path (never a rejection), so counting
        // rejections alone would always read 5/5 and hide the very failure
        // this suite exists to notice.
        completed: outcome.status === "fulfilled" && jobCount > 0,
        error: outcome.status === "rejected" ? String(outcome.reason?.message ?? outcome.reason) : null,
      };
    });

    const completedCount = perAdapter.filter((a) => a.completed).length;
    const rejectedCount = perAdapter.filter((a) => a.settled === "rejected").length;

    return {
      metrics: [
        {
          id: "sweep_ms",
          value: sweepMs,
          n: adapters.length,
          details: { region, radiusMiles, fastTimeoutMs, perAdapter },
        },
        {
          id: "adapters_completed_despite_failure",
          value: completedCount,
          n: adapters.length,
          details: {
            expected: adapters.length - 2,
            rejectedCount,
            perAdapter: perAdapter.map(({ name, settled: s, jobCount, error }) => ({ name, settled: s, jobCount, error })),
          },
        },
      ],
    };
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalAbortTimeout;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

await selfTest(import.meta.url, run);
