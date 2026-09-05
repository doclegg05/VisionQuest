/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers config reads with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Two independent gates stand between a WV Works figure and an employer's
 * screen, and BOTH have to be open:
 *
 *   1. SystemConfig `connect_subsidy_lines_enabled`, so an operator can pull
 *      every benefits sentence off every page with one row;
 *   2. the rule's own `verifiedAt`, set by hand once the local WV Works office
 *      has confirmed the figure (plan P0.8).
 *
 * The table ships with NO rule verified, so today the honest answer is always
 * null and the packet says "Ask about hiring incentives."
 */

const state = { flag: null as string | null };

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async () => state.flag,
  },
});

let subsidyLine: typeof import("./subsidies").subsidyLine;
let SUBSIDY_RULES: typeof import("./subsidies").SUBSIDY_RULES;

before(async () => {
  const mod = await import("./subsidies");
  subsidyLine = mod.subsidyLine;
  SUBSIDY_RULES = mod.SUBSIDY_RULES;
});

const KNOWN_EIP = { subsidyFlags: { eip: "known", esp: "unknown" } };

beforeEach(() => {
  state.flag = null;
});

describe("subsidyLine", () => {
  it("is null when the flag is unset — the default state of the world", async () => {
    assert.equal(await subsidyLine(KNOWN_EIP), null);
  });

  it("is null when the flag is explicitly off", async () => {
    for (const value of ["false", "0", "off", ""]) {
      state.flag = value;
      assert.equal(await subsidyLine(KNOWN_EIP), null, value);
    }
  });

  it("is STILL null with the flag on, because no rule is verified yet", async () => {
    state.flag = "true";
    assert.equal(await subsidyLine(KNOWN_EIP), null);
    // This is the load-bearing half: flipping the operator flag alone must not
    // put an unconfirmed dollar figure in front of an employer.
    assert.equal(SUBSIDY_RULES.eip.verifiedAt, null);
  });

  it("is null for an employer flagged 'unknown' even once a rule is verified", async () => {
    state.flag = "true";
    // "unknown" means nobody has asked, which is not the same as "yes".
    assert.equal(await subsidyLine({ subsidyFlags: { eip: "unknown" } }), null);
  });

  it("is null for an employer with no flags at all", async () => {
    state.flag = "true";
    assert.equal(await subsidyLine({ subsidyFlags: null }), null);
    assert.equal(await subsidyLine({ subsidyFlags: {} }), null);
  });
});
