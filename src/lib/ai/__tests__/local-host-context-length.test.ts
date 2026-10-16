/**
 * The local AI host's context length must match the app's.
 *
 * Ollama's OpenAI-compatible `/v1/chat/completions` ignores `num_ctx`, so a
 * call on that surface runs at the server's default context: 4,096 on any
 * host with less than 24 GiB of VRAM, CPU-only machines included. A prompt
 * longer than the context is cut from the front with HTTP 200, and the front
 * of Sage's prompt holds its identity, guardrails and crisis rules (findings
 * 2026-10-15). The installer pins the server default with
 * OLLAMA_CONTEXT_LENGTH; this test keeps that value equal to
 * OllamaProvider.DEFAULT_NUM_CTX, because a native call that asks for a
 * different context than the loaded one makes Ollama reload the model.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OllamaProvider } from "../ollama-provider";

const installer = readFileSync(
  join(process.cwd(), "scripts", "install-local-ai-services.ps1"),
  "utf8",
);

describe("install-local-ai-services.ps1 context length", () => {
  it("defaults -ContextLength to OllamaProvider.DEFAULT_NUM_CTX", () => {
    const match = installer.match(/\[int\]\s*\$ContextLength\s*=\s*(\d+)/);
    assert.ok(match, "installer declares an [int] $ContextLength parameter with a default");
    assert.equal(Number(match[1]), OllamaProvider.DEFAULT_NUM_CTX);
  });

  it("passes -ContextLength to the Ollama service as OLLAMA_CONTEXT_LENGTH", () => {
    assert.match(installer, /"OLLAMA_CONTEXT_LENGTH=\$ContextLength"/);
  });
});
