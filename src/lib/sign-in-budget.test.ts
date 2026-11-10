import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";

// The per-account sign-in budget has one source.
//
// Sign-in counts wrong passwords against `login:user:<id>`, five per fifteen
// minutes. The change-password route checks the current password, so a wrong
// one there is a guess at the same secret and must spend the same budget. If
// each route built its own key or kept its own numbers, a caller could take
// five guesses at each.

const refunds: { key: string; resetTime: number }[] = [];

mock.module("./rate-limit", {
  exports: {
    refundRateLimit: async (key: string, resetTime: number) => {
      refunds.push({ key, resetTime });
    },
  },
});

let budget: typeof import("./sign-in-budget");

before(async () => {
  budget = await import("./sign-in-budget");
});

beforeEach(() => {
  refunds.length = 0;
});

describe("the per-account sign-in budget", () => {
  it("is five wrong passwords per fifteen minutes", () => {
    assert.equal(budget.ACCOUNT_FAILED_SIGN_IN_LIMIT, 5);
    assert.equal(budget.SIGN_IN_WINDOW_MINUTES, 15);
    assert.equal(budget.SIGN_IN_WINDOW_MS, 15 * 60 * 1000);
  });

  it("keys on the account id, the key sign-in has always used", () => {
    assert.equal(budget.accountSignInLimiterKey("stu-1"), "login:user:stu-1");
  });

  it("remembers the unit an attempt took, so a right password can give it back", () => {
    const result = { success: true, remaining: 4, resetTime: 1_700_000_000_000, degraded: false };

    assert.deepEqual(budget.takenUnit("login:user:stu-1", result), {
      key: "login:user:stu-1",
      resetTime: 1_700_000_000_000,
    });
  });

  it("remembers nothing when the limiter failed open: no unit was taken", () => {
    const result = { success: true, remaining: 0, resetTime: 1_700_000_000_000, degraded: true };

    assert.equal(budget.takenUnit("login:user:stu-1", result), null);
  });

  it("gives each unit back in the window it was taken from, and skips the missing ones", async () => {
    await budget.giveBack([
      { key: "login:203.0.113.9", resetTime: 111 },
      null,
      { key: "login:user:stu-1", resetTime: 222 },
    ]);

    assert.deepEqual(refunds, [
      { key: "login:203.0.113.9", resetTime: 111 },
      { key: "login:user:stu-1", resetTime: 222 },
    ]);
  });
});

describe("one source for the per-account key and numbers", () => {
  const SRC = join(process.cwd(), "src");
  const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
    .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));

  // `login:user:${id}` or "login:user:" + id. A comment that names the key
  // as `login:user:<id>` builds nothing and is left alone.
  const BUILDS_THE_KEY = /login:user:(?:\$\{|["'`]\s*\+)/u;

  it("only this module builds the key", () => {
    const builders = sources.filter(({ text }) => BUILDS_THE_KEY.test(text)).map(({ file }) => file);

    assert.deepEqual(builders, ["lib/sign-in-budget.ts"]);
  });

  it("the scan sees both ways of building it, and not a comment", () => {
    assert.match("const key = `login:user:${student.id}`;", BUILDS_THE_KEY);
    assert.match('const key = "login:user:" + student.id;', BUILDS_THE_KEY);
    assert.doesNotMatch("cannot collide with a real `login:user:<id>`.", BUILDS_THE_KEY);
  });

  it("the sign-in route reads it from here", () => {
    for (const file of ["app/api/auth/login/route.ts"]) {
      const text = sources.find((source) => source.file === file)?.text ?? "";
      assert.match(text, /from "@\/lib\/sign-in-budget"/u, `${file} must import the shared budget`);
      assert.match(text, /accountSignInLimiterKey\(/u, `${file} must build the key with the shared builder`);
      assert.match(text, /ACCOUNT_FAILED_SIGN_IN_LIMIT/u, `${file} must read the shared limit`);
      assert.match(text, /SIGN_IN_WINDOW_MS/u, `${file} must read the shared window`);
    }
  });
});
