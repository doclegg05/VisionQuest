import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { createQueryCounter } from "@/lib/query-counter.test-support";

const TEMPLATE = { id: "tpl-1", certType: "ready-to-work", required: true, needsFile: false, needsVerify: true };
const counter = createQueryCounter({ "orientationItem.count": 8, "certTemplate.findMany": [TEMPLATE] });
mock.module("@/lib/db", { exports: counter.dbModule });

let globals: typeof import("./globals");
let cache: typeof import("@/lib/cache");
before(async () => {
  globals = await import("./globals");
  cache = await import("@/lib/cache");
});
beforeEach(() => {
  cache.invalidateAllChatContext();
  counter.useFixtures({ "orientationItem.count": 8, "certTemplate.findMany": [TEMPLATE] });
});

const reads = async () => (await counter.section(() => globals.readDashboardGlobals())).queries.length;

describe("dashboard globals", () => {
  it("reads the orientation total and the Ready-to-Work templates once, then serves them kept", async () => {
    assert.equal(await reads(), 2);
    assert.equal(await reads(), 0);
    assert.deepEqual(await globals.readDashboardGlobals(), { orientationTotalCount: 8, readyToWorkTemplates: [TEMPLATE] });
  });

  it("never keeps an empty answer, which is what a read that lost its RLS context sees", async () => {
    counter.useFixtures({ "orientationItem.count": 0, "certTemplate.findMany": [] });
    assert.equal(await reads(), 2);
    assert.equal(await reads(), 2);
  });

  it("reads again after the write-through clears every student's chat context", async () => {
    await reads();
    cache.invalidateAllChatContext();
    assert.equal(await reads(), 2);
  });
});
