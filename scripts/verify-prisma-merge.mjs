#!/usr/bin/env node
// No dotenv, database connection, or remote configuration. Each case runs in a
// bounded child so a synchronous recursive-merge regression cannot hang CI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve('@prisma/config'));
const mergePath = configRequire.resolve('deepmerge-ts');
const cases = {
  nested(deepmerge) {
    const left = { migrations: { path: 'prisma/migrations', seed: 'node seed.mjs' }, tables: { external: ['one'] } };
    const right = { migrations: { seed: undefined }, tables: { external: ['two'] } };
    assert.deepEqual(deepmerge(left, right), { migrations: left.migrations, tables: { external: ['one', 'two'] } });
    assert.deepEqual(left.tables.external, ['one']);
    assert.deepEqual(deepmerge({ value: 1 }, { value: null }), { value: null });
  },
  recursive(deepmerge) {
    const a = { value: 1 }; a.self = a;
    const b = { other: 2 }; b.self = b;
    const merged = deepmerge(a, b);
    assert.equal(merged.value, 1); assert.equal(merged.other, 2);
    assert.equal(merged.self, merged);
  },
  shared(deepmerge) {
    const shared = { values: [1], nested: { a: true } };
    const merged = deepmerge({ left: shared, right: shared }, { left: { nested: { b: true } }, right: { values: [2] } });
    assert.deepEqual(merged.left.nested, { a: true, b: true });
    assert.deepEqual(merged.right.values, [1, 2]);
    assert.deepEqual(shared, { values: [1], nested: { a: true } });
  },
  async exports(deepmerge) {
    const esm = await import(pathToFileURL(mergePath.replace(/\.cjs$/, '.mjs')).href);
    assert.deepEqual(esm.deepmerge({ a: 1 }, { b: 2 }), deepmerge({ a: 1 }, { b: 2 }));
  },
  async config() {
    const { loadConfigFromFile } = require('@prisma/config');
    // Under the project so prisma/config resolves without global dependencies.
    const dir = mkdtempSync(join(dirname(dirname(fileURLToPath(import.meta.url))), '.prisma-merge-test-'));
    try {
      writeFileSync(join(dir, 'prisma.config.ts'), `import { defineConfig } from 'prisma/config';
export default defineConfig({ schema: '../prisma/schema.prisma', migrations: { path: '../prisma/migrations', seed: 'node synthetic-seed.mjs' }, experimental: { externalTables: true }, tables: { external: ['visionquest.synthetic_table'] }, engine: 'classic', datasource: { url: 'postgresql://synthetic:synthetic@127.0.0.1:1/disposable' } });`);
      const result = await loadConfigFromFile({ configRoot: dir });
      assert.equal(result.error, undefined);
      assert.equal(result.config.schema, resolve(dir, '../prisma/schema.prisma'));
      assert.equal(result.config.migrations.path, resolve(dir, '../prisma/migrations'));
      assert.equal(result.config.migrations.seed, 'node synthetic-seed.mjs');
      assert.deepEqual(result.config.tables.external, ['visionquest.synthetic_table']);
      assert.equal(result.config.engine, 'classic');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
};
if (process.argv[2] === '--case') {
  const name = process.argv[3];
  assert.ok(Object.hasOwn(cases, name));
  await cases[name](configRequire('deepmerge-ts').deepmerge);
} else {
  for (const name of Object.keys(cases)) {
    test(`Prisma merge compatibility: ${name}`, () => {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', name], {
        timeout: 10000, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CHECKPOINT_DISABLE: '1' },
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    });
  }
}
