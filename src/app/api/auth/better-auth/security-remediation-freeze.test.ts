import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type FrozenManifest = {
  algorithm: "sha256";
  files: Record<string, string>;
};

test("the adversarial authentication remediation tests remain frozen", async () => {
  const manifestPath = path.join(
    process.cwd(),
    "scripts",
    "auth-security-remediation",
    "frozen-tests.json",
  );
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as FrozenManifest;

  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const contents = await readFile(path.join(process.cwd(), relativePath));
    const actualHash = createHash(manifest.algorithm)
      .update(contents)
      .digest("hex");
    assert.equal(actualHash, expectedHash, `${relativePath} changed after freeze`);
  }
});

