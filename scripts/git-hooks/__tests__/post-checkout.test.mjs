import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve(import.meta.dirname, '..', 'post-checkout');
const ZERO = '0'.repeat(40);

function setup({ ownNodeModules }) {
  const dir = mkdtempSync(join(tmpdir(), 'post-checkout-'));
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  const log = join(dir, 'npx.log');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(log, '');
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "$@" >> "${log}"\n`);
  chmodSync(join(bin, 'npx'), 0o755);
  const gitLog = join(dir, 'git.log');
  writeFileSync(gitLog, '');
  const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash\necho "$@" >> "${gitLog}"\nexec "${realGit}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com',
  };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  mkdirSync(join(repo, 'prisma'));
  writeFileSync(join(repo, 'prisma', 'schema.prisma'), 'model A {}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'prisma', 'schema.prisma'), 'model A {}\nmodel B {}\n');
  git('commit', '-q', '-am', 'two');
  const second = git('rev-parse', 'HEAD');
  if (ownNodeModules) mkdirSync(join(repo, 'node_modules', '.prisma'), { recursive: true });
  const run = (oldSha, newSha, flag) =>
    spawnSync('bash', [HOOK, oldSha, newSha, flag], { cwd: repo, env, encoding: 'utf8' });
  const npxLog = () => readFileSync(log, 'utf8');
  const gitCalls = () => readFileSync(gitLog, 'utf8');
  return { dir, first, second, run, npxLog, gitCalls };
}

function withRepo(opts, fn) {
  const ctx = setup(opts);
  try {
    fn(ctx);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
}

test('hook file exists', () => {
  assert.ok(existsSync(HOOK));
});

test('generates when schema changed and own node_modules', () => {
  withRepo({ ownNodeModules: true }, ({ first, second, run, npxLog }) => {
    const r = run(first, second, '1');
    assert.equal(r.status, 0);
    assert.match(npxLog(), /prisma generate/);
  });
});

test('skips generate without own node_modules', () => {
  withRepo({ ownNodeModules: false }, ({ first, second, run, npxLog }) => {
    const r = run(first, second, '1');
    assert.equal(r.status, 0);
    assert.equal(npxLog(), '');
    assert.match(r.stdout, /no own node_modules/);
  });
});

test('no-op when schema unchanged', () => {
  withRepo({ ownNodeModules: true }, ({ second, run, npxLog }) => {
    const r = run(second, second, '1');
    assert.equal(r.status, 0);
    assert.equal(npxLog(), '');
  });
});

test('file checkout flag 0 is a no-op', () => {
  withRepo({ ownNodeModules: true }, ({ first, second, run, npxLog }) => {
    const r = run(first, second, '0');
    assert.equal(r.status, 0);
    assert.equal(npxLog(), '');
  });
});

test('null old sha is a no-op', () => {
  withRepo({ ownNodeModules: true }, ({ second, run, npxLog, gitCalls }) => {
    const before = gitCalls();
    const r = run(ZERO, second, '1');
    assert.equal(r.status, 0);
    assert.equal(npxLog(), '');
    assert.equal(gitCalls().slice(before.length).includes('diff'), false, 'guard must stop before git diff');
  });
});
