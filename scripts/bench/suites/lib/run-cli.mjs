/**
 * Shared subprocess runner for benchmark suites that wrap an existing
 * scripts/sage-*.mjs instrument rather than re-implement its logic in-process.
 * Every suite that shells out to a harness (rag-retrieval, rag-abstention,
 * sage-grounding, sage-career, sage-readability) goes through this so the
 * "extend, never relax" rule is trivially true — the instrument's own CLI
 * runs byte-for-byte unmodified, in its own process, with its own real exit
 * behavior. We only read back the `--out=<path>` JSON report it already
 * knows how to write.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Run `npx tsx <scriptPath> <args...> --out=<tmpfile>` and return the parsed
 * JSON the script wrote to `--out`. Throws with stdout/stderr attached on a
 * non-zero exit UNLESS `allowNonZeroExit` is set (some harnesses use
 * `process.exitCode = 1` on --strict-style flags we deliberately don't pass,
 * but a caller can opt in if a given instrument's exit code is not the
 * success signal to trust).
 *
 * @param {string} scriptPath - repo-relative path to the .mjs script
 * @param {string[]} args - extra CLI args (do not include --out; it's added here)
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - env overlay merged onto process.env
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.allowNonZeroExit]
 */
export async function runScriptForJsonReport(scriptPath, args = [], opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vq-bench-"));
  const outPath = join(dir, "report.json");
  try {
    const fullArgs = [scriptPath, ...args, `--out=${outPath}`];
    try {
      await execFileAsync("npx", ["tsx", ...fullArgs], {
        cwd: process.cwd(),
        env: { ...process.env, ...(opts.env ?? {}) },
        timeout: opts.timeoutMs ?? 180_000,
        maxBuffer: 1024 * 1024 * 64,
      });
    } catch (error) {
      if (!opts.allowNonZeroExit) {
        throw new Error(
          `${scriptPath} exited non-zero: ${error.message}\n--- stdout ---\n${error.stdout ?? ""}\n--- stderr ---\n${error.stderr ?? ""}`,
        );
      }
    }
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
