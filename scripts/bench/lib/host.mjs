/**
 * Host recording.
 *
 * "Record the host" is a rule, not a nicety (design §6): every local-model
 * number in this repo's history has an unrecorded host, which is why they
 * contradict each other. Every result file carries this block, every baseline
 * row carries the one-line fingerprint, and `bench:validate` refuses a suite
 * that requires `ollama` without one.
 */

import os from "node:os";

const OLLAMA_PROBE_TIMEOUT_MS = 1500;

/**
 * The machine as it is right now. `ollama` stays null until something probes
 * for it, so a result never implies a local model was involved when it was
 * not.
 *
 * @returns {{ os: string, cpus: number, memGb: number, node: string, ollama: string|null }}
 */
export function describeHost() {
  return {
    os: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus()?.length ?? 0,
    memGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    ollama: null,
  };
}

/**
 * Ask a reachable Ollama for its version. Never throws and never blocks a
 * benchmark run: an unreachable host records `null`, which reads honestly as
 * "no local model here".
 *
 * @param {string|null|undefined} ollamaHost
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<string|null>}
 */
export async function ollamaVersion(ollamaHost, options = {}) {
  if (typeof ollamaHost !== "string" || ollamaHost.trim().length === 0) return null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;

  const base = ollamaHost.trim().replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? OLLAMA_PROBE_TIMEOUT_MS;

  try {
    const response = await fetchImpl(`${base}/api/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) return null;
    const body = await response.json();
    const version = body?.version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * A copy of `host` with the probed Ollama version attached. The input is not
 * mutated, so a caller can keep the un-probed block for a run that never
 * touched a local model.
 *
 * @param {ReturnType<typeof describeHost>} host
 * @param {string|null|undefined} ollamaHost
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function withOllama(host, ollamaHost, options = {}) {
  const version = await ollamaVersion(ollamaHost, options);
  return { ...host, ollama: version };
}

/**
 * The one-line form stored in a baseline row, so two numbers measured on
 * different machines are visibly different rather than silently compared.
 *
 * @param {ReturnType<typeof describeHost>} host
 */
export function hostFingerprint(host) {
  const parts = [host.os, `${host.cpus} cpu`, `${host.memGb} GB`, host.node];
  if (host.ollama) parts.push(`ollama ${host.ollama}`);
  return parts.join(" · ");
}
