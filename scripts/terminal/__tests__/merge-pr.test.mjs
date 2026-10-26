import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'merge-pr.sh');

const FAKE_GH = `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then
  echo "fake merge output"
  exit "\${FAKE_GH_MERGE_EXIT:-0}"
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo "\${FAKE_GH_STATE:-}"
  exit 0
fi
exit 0
`;

function run(args, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-pr-'));
  try {
    const gh = path.join(dir, 'gh');
    writeFileSync(gh, FAKE_GH);
    chmodSync(gh, 0o755);
    return spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        MERGE_PR_POLL_SECONDS: '0',
        ...env,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('nonzero gh exit but MERGED state succeeds', () => {
  const r = run(['12'], { FAKE_GH_MERGE_EXIT: '1', FAKE_GH_STATE: 'MERGED abc123' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /MERGED abc123/);
});

test('OPEN state fails', () => {
  const r = run(['12'], { FAKE_GH_MERGE_EXIT: '0', FAKE_GH_STATE: 'OPEN ' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /OPEN/);
});

test('rejects non-numeric PR', () => {
  const r = run(['abc'], {});
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/i);
});

test('rejects missing PR and unknown method', () => {
  assert.equal(run([], {}).status, 2);
  assert.equal(run(['12', 'rebase'], {}).status, 2);
});
