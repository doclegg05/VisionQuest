import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { bundledCandidatePaths } from "@/lib/storage";
import { FORMS } from "@/lib/spokes/forms";

// Production-parity gate for /api/forms/download's bundled-PDF fallback.
// No skip guards: if a FORMS[] storageKey has no git-tracked bundled source,
// the deployed server cannot serve it when the bucket object is missing, and
// this test MUST fail — a silent skip here is exactly the bug this guards.

const root = process.cwd();

const STORAGE_KEYS = [
  ...new Set(
    FORMS.map((form) => form.storageKey).filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    ),
  ),
];

function findLocalCandidate(baseDir: string, storageKey: string): string | null {
  return (
    bundledCandidatePaths(storageKey).find((candidate) =>
      existsSync(path.join(baseDir, candidate)),
    ) ?? null
  );
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("bundled form sources (git-tracked production parity)", () => {
  it("FORMS[] has at least one storageKey to guard", () => {
    assert.ok(STORAGE_KEYS.length > 0);
    assert.ok(
      STORAGE_KEYS.includes("orientation/SPOKES_Student_Profile_FY26_Fillable.pdf"),
      "the SPOKES Student Profile form (Sage's 'Open form' target) must be present",
    );
  });

  for (const storageKey of STORAGE_KEYS) {
    it(`has a git-tracked bundled source for "${storageKey}"`, () => {
      const candidate = findLocalCandidate(path.join(root, "docs-upload"), storageKey);
      assert.ok(
        candidate,
        `no file under docs-upload/ resolves storageKey "${storageKey}" `
          + `(candidates: ${bundledCandidatePaths(storageKey).join(", ")})`,
      );

      const tracked = spawnSync(
        "git",
        ["ls-files", "--", `docs-upload/${candidate}`],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(tracked.status, 0, `git ls-files failed: ${tracked.stderr}`);
      assert.ok(
        tracked.stdout.trim().length > 0,
        `docs-upload/${candidate} exists locally but is NOT git-tracked — `
          + "it will be absent from the repo a production deploy is built from",
      );
    });
  }
});

describe("standalone asset staging (scripts/prepare-standalone-assets.mjs)", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "vq-standalone-"));
  const standaloneDir = path.join(scratch, "standalone");

  after(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("stages a bundled PDF for every FORMS[] entry with a storageKey", () => {
    mkdirSync(standaloneDir, { recursive: true });

    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    assert.ok(existsSync(tsxCli), "tsx CLI not found in node_modules");

    const run = spawnSync(
      process.execPath,
      [tsxCli, path.join("scripts", "prepare-standalone-assets.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, STANDALONE_DIR: standaloneDir },
      },
    );
    assert.equal(
      run.status,
      0,
      `prepare-standalone-assets.mjs exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
    );

    const missing: string[] = [];
    for (const storageKey of STORAGE_KEYS) {
      const staged = findLocalCandidate(
        path.join(standaloneDir, "docs-upload"),
        storageKey,
      );
      if (!staged) {
        missing.push(storageKey);
        continue;
      }

      // Byte-identity: the staged copy must match the repo source exactly.
      const source = findLocalCandidate(path.join(root, "docs-upload"), storageKey);
      assert.ok(source, `source disappeared mid-test for "${storageKey}"`);
      assert.equal(
        sha256(path.join(standaloneDir, "docs-upload", staged)),
        sha256(path.join(root, "docs-upload", source)),
        `staged copy of "${storageKey}" differs from its docs-upload source`,
      );
    }

    assert.deepEqual(
      missing,
      [],
      `storageKeys with no staged bundled PDF under the standalone dir: ${missing.join(", ")}`,
    );
  });
});
