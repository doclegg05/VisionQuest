import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

import type { BenchmarkDashboardData } from "@/lib/benchmarks/dashboard";

/**
 * The gate is the point of this file: a benchmark dashboard is an engineering
 * report about the whole program, and the plan puts it behind the admin flag,
 * not merely behind staff. A teacher who types the URL must get the not-found
 * page — never the numbers.
 */

let role = "admin";

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () =>
      role === "none"
        ? null
        : { id: "u1", studentId: "s1", displayName: "Test Admin", role },
  },
});

class RedirectSignal extends Error {}
class NotFoundSignal extends Error {}

mock.module("next/navigation", {
  namedExports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
    notFound: () => {
      throw new NotFoundSignal("not-found");
    },
  },
});

const data: BenchmarkDashboardData = {
  areas: [
    {
      area: "safety",
      suites: [
        {
          suite: "crisis-en",
          title: "Crisis detector, English",
          area: "safety",
          tier: "gate",
          state: "fail",
          hasResult: true,
          blocking: true,
          ranAt: "2026-09-05T04:00:00.000Z",
          commit: "abc1234",
          provider: null,
          model: null,
          durationMs: 1200,
          note: null,
          notes: "Tier is watch on purpose.",
          problem: null,
          metrics: [
            {
              id: "recall_must_detect",
              value: 0.72,
              unit: "ratio",
              displayUnit: null,
              n: 200,
              floor: 0.98,
              tolerance: 0.01,
              direction: "higher",
              exact: false,
              baseline: 0.99,
              delta: -0.27,
              movement: "worse",
              status: "fail",
              tracked: false,
              reason: null,
            },
          ],
        },
      ],
    },
  ],
  summary: {
    suitesTotal: 1,
    suitesWithResults: 1,
    gateTotal: 1,
    gatePassing: 0,
    gateWatching: 0,
    gateFailing: 1,
    gateNotRun: 0,
    otherFailing: 0,
  },
  lastRanAt: "2026-09-05T04:00:00.000Z",
  lastCommit: "abc1234",
  problems: [],
};

const loadCalls: number[] = [];

mock.module("@/lib/benchmarks/dashboard", {
  namedExports: {
    loadBenchmarkDashboard: () => {
      loadCalls.push(1);
      return data;
    },
  },
});

// Imported lazily rather than at the top level: the module mocks above must
// be registered first, and a top-level await is not available under the
// test transform.
async function render(): Promise<string> {
  const { default: BenchmarksPage } = await import("./page");
  return renderToString(await BenchmarksPage());
}

describe("BenchmarksPage admin gate", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    role = "none";
    await assert.rejects(render, RedirectSignal);
  });

  it("gives a teacher the not-found page, not the numbers", async () => {
    role = "teacher";
    const before = loadCalls.length;
    await assert.rejects(render, NotFoundSignal);
    // The loader must never even run for a non-admin.
    assert.equal(loadCalls.length, before);
  });

  it("gives a coordinator the not-found page too", async () => {
    role = "coordinator";
    await assert.rejects(render, NotFoundSignal);
  });

  it("renders the report for an admin", async () => {
    role = "admin";
    const html = await render();
    assert.ok(html.includes("Benchmarks"));
    assert.ok(html.includes("Crisis detector, English"));
  });
});

describe("BenchmarksPage presentation", () => {
  it("pairs every colour with a word", async () => {
    role = "admin";
    const html = await render();
    // The failing suite says so in words, not only in red.
    assert.ok(html.includes("Below the floor"));
    assert.ok(html.includes("Worse"));
  });

  it("uses no arrow characters to carry meaning", async () => {
    role = "admin";
    const html = await render();
    for (const arrow of ["↑", "↓", "→", "←", "▲", "▼"]) {
      assert.ok(!html.includes(arrow), `found arrow ${arrow}`);
    }
  });

  it("keeps the table inside its own horizontal scroll box", async () => {
    role = "admin";
    const html = await render();
    const tableIndex = html.indexOf("<table");
    assert.ok(tableIndex > 0);
    const wrapper = html.lastIndexOf("overflow-x-auto", tableIndex);
    assert.ok(wrapper > 0, "the table must sit inside an overflow-x-auto box");
  });

  it("shows a ratio as a percent so a non-coder reads it correctly", async () => {
    role = "admin";
    const html = await render();
    assert.ok(html.includes("72.0%"));
    assert.ok(html.includes("99.0%"));
  });

  it("names the floor and which way is better", async () => {
    role = "admin";
    const html = await render();
    assert.ok(html.includes("98.0% or more"));
    assert.ok(html.includes("Higher is better."));
  });
});
