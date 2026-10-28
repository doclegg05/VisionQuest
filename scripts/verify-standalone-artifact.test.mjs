import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./verify-standalone-artifact.mjs', import.meta.url));
function fixture(work) {
  const cwd = mkdtempSync(join(tmpdir(), 'vq-artifact-screen-'));
  const root = join(cwd, '.next/standalone');
  mkdirSync(join(root, '.next/static'), { recursive: true });
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'server.js'), '// synthetic artifact');
  try { work(root); return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } }); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}
function findings(result) { assert.equal(result.error, undefined); return JSON.parse(result.stdout).findings; }

test('accepts an ordinary artifact and its internal dependency alias', () => {
  const result = fixture(root => symlinkSync('server.js', join(root, 'alias.js')));
  assert.deepEqual(findings(result), []); assert.equal(result.status, 0);
});
test('rejects forbidden names even when they are internal symlinks or empty directories', () => {
  const result = fixture(root => {
    symlinkSync('server.js', join(root, '.env.production'));
    symlinkSync('server.js', join(root, 'hidden.test.js'));
    mkdirSync(join(root, '.git'));
  });
  assert.equal(result.status, 1);
  assert.deepEqual(findings(result).filter(f => f.category === 'private-or-test-artifact').map(f => f.path).sort(), ['.env.production', '.git', 'hidden.test.js']);
});
for (const format of ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ', 'DSA ']) {
  test(`rejects ${format || 'generic '}private-key markers without printing matching values`, () => {
    const marker = `-----BEGIN ${format}PRIVATE KEY-----`;
    const result = fixture(root => writeFileSync(join(root, 'payload'), marker));
    assert.equal(result.status, 1);
    assert.ok(findings(result).some(f => f.category === 'private-key-marker'));
    assert.ok(!result.stdout.includes(marker));
  });
}
test('rejects escaping and broken links', () => {
  const result = fixture(root => {
    symlinkSync(tmpdir(), join(root, 'escape'));
    symlinkSync('absent', join(root, 'broken'));
  });
  assert.equal(result.status, 1);
  assert.deepEqual(findings(result).map(f => f.category).sort(), ['broken-symlink', 'escaping-symlink']);
});
