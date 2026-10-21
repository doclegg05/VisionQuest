import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'branch-cleanup.sh');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Temp bare remote plus a clone with branches a, b, c pushed.
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'branch-cleanup-'));
  const bare = path.join(root, 'remote.git');
  const clone = path.join(root, 'clone');
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'clone', bare, clone);
  git(clone, 'checkout', '-b', 'main');
  git(clone, 'commit', '--allow-empty', '-m', 'init');
  git(clone, 'push', 'origin', 'main');
  const shas = {};
  for (const name of ['a', 'b', 'c']) {
    git(clone, 'checkout', '-b', name, 'main');
    git(clone, 'commit', '--allow-empty', '-m', `work on ${name}`);
    git(clone, 'push', 'origin', name);
    shas[name] = git(clone, 'rev-parse', 'HEAD');
  }
  git(clone, 'checkout', 'main');
  return { root, bare, clone, shas };
}

function remoteRefs(bare) {
  return git(bare, 'for-each-ref', '--format=%(refname)');
}

function manifest(root, rows) {
  const file = path.join(root, 'manifest.tsv');
  writeFileSync(file, rows.map((r) => r.join('\t')).join('\n') + '\n');
  return file;
}

function run(clone, file, flags) {
  return spawnSync('bash', [script, file, ...flags, '--remote', 'origin'], {
    cwd: clone,
    env: ENV,
    encoding: 'utf8',
  });
}

test('dry run changes nothing', () => {
  const { root, bare, clone, shas } = setup();
  try {
    const file = manifest(root, [
      ['# comment'],
      ['a', shas.a, 'delete'],
      ['b', shas.b, 'archive'],
    ]);
    const before = remoteRefs(bare);
    const r = run(clone, file, []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`WOULD delete a @ ${shas.a}`));
    assert.match(r.stdout, new RegExp(`WOULD archive b @ ${shas.b}`));
    assert.equal(remoteRefs(bare), before);
    for (const n of ['a', 'b', 'c']) {
      assert.match(remoteRefs(bare), new RegExp(`refs/heads/${n}$`, 'm'));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply deletes and archives', () => {
  const { root, bare, clone, shas } = setup();
  try {
    const file = manifest(root, [
      ['a', shas.a, 'delete'],
      ['b', shas.b, 'archive'],
    ]);
    const r = run(clone, file, ['--apply']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const refs = remoteRefs(bare);
    assert.doesNotMatch(refs, /refs\/heads\/a$/m);
    assert.doesNotMatch(refs, /refs\/heads\/b$/m);
    assert.match(refs, /refs\/heads\/c$/m);
    assert.match(refs, /refs\/tags\/archive\/b$/m);
    assert.equal(git(bare, 'rev-parse', 'refs/tags/archive/b'), shas.b);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses moved tip and continues', () => {
  const { root, bare, clone, shas } = setup();
  try {
    const stale = shas.b; // a real commit, but not a's tip
    const file = manifest(root, [
      ['a', stale, 'delete'],
      ['c', shas.c, 'delete'],
    ]);
    const r = run(clone, file, ['--apply']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /REFUSED a/);
    const refs = remoteRefs(bare);
    assert.match(refs, /refs\/heads\/a$/m);
    assert.doesNotMatch(refs, /refs\/heads\/c$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
