/**
 * Which caches are live under the renderer the M1 and M6 measurements use:
 * `prerenderToNodeStream` from `react-dom/static`, run by node:test with no
 * `react-server` export condition. The answer decides whether a per-request
 * loader shows up in those counts; the dashboard test's header states it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cache } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { cached } from "@/lib/cache";

async function render(node: React.ReactNode): Promise<void> {
  const { prelude } = await prerenderToNodeStream(node);
  for await (const chunk of prelude) void chunk;
}

describe("caches under the measurement renderer", () => {
  it("React.cache does not memoize: two components asking for one key both run the loader", async () => {
    let calls = 0;
    const load = cache(async (key: string) => {
      calls += 1;
      return key;
    });
    async function First() {
      return <p>{await load("student-1")}</p>;
    }
    async function Second() {
      return <p>{await load("student-1")}</p>;
    }

    await render(<div><First /><Second /></div>);

    // React 19's non-server build exports cache(fn) as a pass-through
    // (node_modules/react/cjs/react.development.js). Production renders server
    // components with the react-server build, where it does memoize per request.
    assert.equal(calls, 2);
  });

  it("the process cache cached() is live: the second read in one render is served from memory", async () => {
    let calls = 0;
    const read = () => cached("readiness-probe:student-1", 60, async () => {
      calls += 1;
      return "value";
    });
    async function First() {
      return <p>{await read()}</p>;
    }
    async function Second() {
      return <p>{await read()}</p>;
    }

    await render(<div><First /></div>);
    await render(<div><Second /></div>);

    assert.equal(calls, 1);
  });
});
