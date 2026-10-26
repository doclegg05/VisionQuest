// Host recording. The 2026-08-21 lesson: every local-model number in this
// repo has an unrecorded host, which is why they contradict each other.
import test from "node:test";
import assert from "node:assert/strict";

import { describeHost, hostFingerprint, ollamaVersion, withOllama } from "../lib/host.mjs";

test("describeHost records os, cpus, memGb and node", () => {
  const host = describeHost();
  assert.equal(typeof host.os, "string");
  assert.ok(host.os.length > 0);
  assert.ok(Number.isInteger(host.cpus) && host.cpus > 0);
  assert.ok(typeof host.memGb === "number" && host.memGb > 0);
  assert.equal(host.node, process.version);
  assert.equal(host.ollama, null, "ollama stays null until it is probed");
});

test("hostFingerprint is a single stable line for the baseline row", () => {
  const line = hostFingerprint({ os: "linux x64", cpus: 4, memGb: 16, node: "v22.0.0", ollama: null });
  assert.equal(line, "linux x64 · 4 cpu · 16 GB · v22.0.0");
});

test("hostFingerprint includes the Ollama version when one was probed", () => {
  const line = hostFingerprint({ os: "darwin arm64", cpus: 10, memGb: 32, node: "v24.0.0", ollama: "0.32.4" });
  assert.match(line, /ollama 0\.32\.4$/);
});

test("ollamaVersion returns the version string from /api/version", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ version: "0.32.4" }) };
  };
  const version = await ollamaVersion("http://localhost:11434", { fetchImpl });
  assert.equal(version, "0.32.4");
  assert.deepEqual(calls, ["http://localhost:11434/api/version"]);
});

test("ollamaVersion tolerates a trailing slash on OLLAMA_HOST", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ version: "1.0.0" }) };
  };
  await ollamaVersion("http://localhost:11434/", { fetchImpl });
  assert.deepEqual(calls, ["http://localhost:11434/api/version"]);
});

test("an unreachable or non-OK Ollama host records null, never throws", async () => {
  const thrower = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await ollamaVersion("http://localhost:11434", { fetchImpl: thrower }), null);
  const notOk = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await ollamaVersion("http://localhost:11434", { fetchImpl: notOk }), null);
  assert.equal(await ollamaVersion(null, { fetchImpl: thrower }), null);
});

test("withOllama attaches the probed version without mutating the input host", async () => {
  const base = describeHost();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.9.9" }) });
  const probed = await withOllama(base, "http://localhost:11434", { fetchImpl });
  assert.equal(probed.ollama, "0.9.9");
  assert.equal(base.ollama, null);
});
