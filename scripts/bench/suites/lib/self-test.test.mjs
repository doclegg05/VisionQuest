import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequirements } from "./self-test.mjs";

test("checkRequirements: openrouter is a known requirement, met by OPENROUTER_API_KEY", () => {
  const saved = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.deepEqual(checkRequirements(["openrouter"]), ["OPENROUTER_API_KEY is not set"]);
    process.env.OPENROUTER_API_KEY = "or-key";
    assert.deepEqual(checkRequirements(["openrouter"]), []);
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  }
});
