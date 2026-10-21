import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'run-with-env.mjs',
);
const DB_URL = 'postgresql://u:s3cretpw$pw@db.example.test:5432/x';
const ENV_FILE = `DATABASE_URL=${DB_URL}\nOPENROUTER_API_KEY=sk-or-fake-value\n`;

// The Claude Code session sandbox denies reading any file named .env.local.
// Probe once; tests that need the runner to read it skip there and run
// everywhere else (CI, a normal terminal).
function canReadEnvLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-probe-'));
  try {
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(file, 'X=1\n');
    fs.readFileSync(file, 'utf8');
    return true;
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'ENOENT') return false;
    throw err;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Cleanup of the probe dir is best effort under the sandbox.
    }
  }
}
const NEEDS_ENV = canReadEnvLocal()
  ? {}
  : { skip: 'sandbox denies reading .env.local' };

function setup({ withEnv = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-with-env-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const marker = path.join(dir, 'npm-ran');
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/bin/bash\ntouch "${marker}"\necho "ARGS=$*"\necho "KEY_SEEN=\${OPENROUTER_API_KEY:+yes}"\necho "DB_LEN=\${#DATABASE_URL}"\n`,
    { mode: 0o755 },
  );
  if (withEnv) fs.writeFileSync(path.join(dir, '.env.local'), ENV_FILE);
  return { dir, bin, marker };
}

function run(ctx, args) {
  const env = { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}` };
  delete env.DATABASE_URL;
  delete env.OPENROUTER_API_KEY;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ctx.dir,
    env,
    encoding: 'utf8',
  });
}

function withCtx(opts, fn) {
  const ctx = setup(opts);
  try {
    fn(ctx);
  } finally {
    try {
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    } catch (err) {
      // The Claude Code session sandbox denies deleting any file named
      // .env.local, so cleanup fails there. A leftover temp dir is harmless
      // and must not mask the test result.
      if (err.code !== 'ENOTEMPTY' && err.code !== 'EPERM') throw err;
    }
  }
}

test('loads env for npm', NEEDS_ENV, () => {
  withCtx({}, (ctx) => {
    const r = run(ctx, ['--yes', 'demo']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /KEY_SEEN=yes/);
  });
});

test('never prints secret values', NEEDS_ENV, () => {
  withCtx({}, (ctx) => {
    const r = run(ctx, ['--yes', 'demo']);
    const logDir = path.join(ctx.dir, 'reports', 'terminal');
    const log = fs
      .readdirSync(logDir)
      .map((f) => fs.readFileSync(path.join(logDir, f), 'utf8'))
      .join('');
    for (const text of [r.stdout, r.stderr, log]) {
      assert.ok(!text.includes('s3cretpw'));
      assert.ok(!text.includes('sk-or-fake-value'));
    }
    assert.match(r.stdout, /Target DB host: db\.example\.test/);
  });
});

test('writes a log under reports/terminal', NEEDS_ENV, () => {
  withCtx({}, (ctx) => {
    run(ctx, ['--yes', 'demo']);
    const logs = fs
      .readdirSync(path.join(ctx.dir, 'reports', 'terminal'))
      .filter((f) => f.endsWith('-demo.log'));
    assert.equal(logs.length, 1);
  });
});

test('missing env file exits 2', () => {
  withCtx({ withEnv: false }, (ctx) => {
    const r = run(ctx, ['--yes', 'demo']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.env\.local not found/);
  });
});

test('dollar sign survives', NEEDS_ENV, () => {
  withCtx({}, (ctx) => {
    const r = run(ctx, ['--yes', 'demo']);
    assert.match(r.stdout, new RegExp(`DB_LEN=${DB_URL.length}\\b`));
  });
});

test('rejects unsafe script name', () => {
  withCtx({}, (ctx) => {
    const r = run(ctx, ['--yes', 'demo;rm']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /[Uu]sage/);
    assert.ok(!fs.existsSync(ctx.marker));
  });
});

test('leading -- is not doubled', NEEDS_ENV, () => {
  withCtx({}, (ctx) => {
    const r = run(ctx, ['--yes', 'demo', '--', '--flag=x']);
    assert.equal(r.status, 0, r.stderr);
    const line = r.stdout.split('\n').find((l) => l.startsWith('ARGS='));
    const args = line.slice('ARGS='.length).split(' ');
    assert.ok(args.includes('--flag=x'));
    assert.equal(args.filter((a) => a === '--').length, 1);
  });
});
