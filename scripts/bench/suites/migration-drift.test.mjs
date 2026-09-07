import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CREATE_TABLE_RE } from "./migration-drift.mjs";

function created(sql) {
  const out = [];
  const re = new RegExp(CREATE_TABLE_RE.source, "g");
  let m;
  while ((m = re.exec(sql)) !== null) out.push(m[1]);
  return out;
}

describe("migration-drift CREATE_TABLE_RE", () => {
  it("counts a plain CREATE TABLE", () => {
    assert.deepEqual(created('CREATE TABLE "visionquest"."Foo" (id TEXT);'), ["Foo"]);
  });

  it("counts CREATE TABLE IF NOT EXISTS, the idempotent-adoption form (2026-09-07)", () => {
    // Red before the widening: an adoption migration written this way vanished
    // from the gate's inventory, so a missing RLS on it could never be reported.
    assert.deepEqual(created('CREATE TABLE IF NOT EXISTS "visionquest"."Bar" (id TEXT);'), ["Bar"]);
  });

  it("ignores other schemas", () => {
    assert.deepEqual(created('CREATE TABLE IF NOT EXISTS "public"."Nope" (id TEXT);'), []);
  });
});
