import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFromFile } from "@prisma/config";

// Resolve from Prisma, not the project root: a nested vulnerable copy must
// not silently survive the transitive dependency override.
const prismaRequire = createRequire(createRequire(import.meta.url).resolve("@prisma/config"));

test("Prisma's deepmerge handles recursive graphs (GHSA-ggr8-5vv4-36mx)", () => {
  const { deepmerge } = prismaRequire("deepmerge-ts");
  const left: Record<string, unknown> = { left: true };
  const right: Record<string, unknown> = { right: true };
  left.self = left;
  right.self = right;
  const merged = deepmerge(left, right);
  assert.equal(merged.left, true);
  assert.equal(merged.right, true);
  assert.equal(merged.self, merged);
});

test("Prisma config loader remains compatible with the patched merger", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "vq-prisma-config-")));
  try {
    await writeFile(join(directory, "prisma.config.js"),
      'module.exports = { schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" } };\n');
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.equal(result.error, undefined);
    assert.equal(result.config.schema, join(directory, "prisma/schema.prisma"));
    assert.equal(result.config.migrations?.path, join(directory, "prisma/migrations"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
