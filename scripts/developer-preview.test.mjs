import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { environment, privateDirectory, ownedFile, contained, processIdentity, processMatches, assertProcess, availablePort, toolingProxy, noDotenv, requireHost, command, sandbox } from './developer-preview-support.mjs';

const fixture = () => mkdtempSync(join(tmpdir(), 'vq-preview-test-'));
test('environment replaces hostile inherited service/config/node settings', () => {
  const old = process.env.NODE_OPTIONS; process.env.NODE_OPTIONS = '--require /hostile';
  try { const env = environment('/private/runtime', '/pg'); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.ADMIN_DATABASE_URL, undefined); assert.equal(env.SMTP_HOST, undefined); assert.equal(env.GEMINI_API_KEY, undefined); assert.equal(env.HOME, '/private/runtime/home'); assert.match(env.DATABASE_URL, /127\.0\.0\.1:1/); }
  finally { if (old === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = old; }
});
test('private directories and credentials reject permissive paths and symlinks', () => {
  const root = fixture();
  try {
    privateDirectory(root); const child = join(root, 'child'); mkdirSync(child, { mode: 0o700 }); privateDirectory(child);
    chmodSync(child, 0o755); assert.throws(() => privateDirectory(child));
    symlinkSync(child, join(root, 'link')); assert.throws(() => privateDirectory(join(root, 'link')));
    const secret = join(root, 'secret'); writeFileSync(secret, 'synthetic', { mode: 0o600 }); ownedFile(secret); chmodSync(secret, 0o644); assert.throws(() => ownedFile(secret));
  } finally { rmSync(root, { recursive: true }); }
});
test('containment refuses escaping symlinks and root deletion selection', () => {
  const root = fixture(); try { symlinkSync(tmpdir(), join(root, 'escape')); assert.throws(() => contained(root, join(root, 'escape'))); assert.throws(() => contained(root, root)); } finally { rmSync(root, { recursive: true }); }
});
test('stale or forged PID identity cannot authorize a signal', () => {
  const own = { pid: process.pid, identity: processIdentity(process.pid) }; assert.equal(processMatches(own), true);
  assert.equal(processMatches({ ...own, identity: 'foreign' }), false); assert.throws(() => assertProcess({ ...own, identity: 'foreign' })); assert.throws(() => assertProcess({ pid: 1, identity: 'anything' }));
});
test('occupied ports are left alone; allocate a different loopback port', async () => {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { assert.notEqual(await availablePort(), server.address().port); assert.equal(server.listening, true); } finally { server.close(); }
});
test('tooling proxy rejects arbitrary destinations without forwarding', async () => {
  const proxy = await toolingProxy();
  try {
    const url = new URL(proxy.url); const reply = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(url.port), url.hostname, () => socket.write('CONNECT attacker.invalid:443 HTTP/1.1\r\nHost: attacker.invalid\r\n\r\n'));
      socket.setTimeout(2000, () => socket.destroy(new Error('timeout'))); socket.on('data', data => { resolve(data.toString()); socket.destroy(); }); socket.on('error', reject);
    }); assert.match(reply, /403 Forbidden/);
  } finally { proxy.close(); }
});
test('dotenv inputs are rejected before build', () => {
  const root = fixture(); try { writeFileSync(join(root, '.env.local'), 'synthetic'); assert.throws(() => noDotenv(root)); } finally { rmSync(root, { recursive: true }); }
});
test('missing prerequisites and wrong platform/version fail descriptively', () => {
  assert.throws(() => requireHost('linux', '24.0.0', []), /macOS/);
  assert.throws(() => requireHost('darwin', '22.0.0', []), /Node 24/);
  assert.throws(() => requireHost('darwin', '24.0.0', ['/required/postgres'], () => false), /Missing prerequisite/);
});
test('command timeout kills its dedicated group including TERM-resistant descendants and closes pipes', { timeout: 10000 }, async () => {
  const root = fixture();
  mkdirSync(join(root, 'logs'), { mode: 0o700 });
  writeFileSync(join(root, 'network.sb'), sandbox, { mode: 0o600 });
  const pidFile = join(root, 'descendant.json');
  const descendant = `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid,parent:process.ppid})); setInterval(()=>{},100);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'}); setInterval(()=>{},100);`;
  const started = Date.now();
  try {
    await assert.rejects(command({ project: root, runtime: root, env: environment(root, '/unused') }, 'timeout-regression', [process.execPath, '-e', parent], { timeout: 750, isolated: process.platform === 'darwin' }), /timeout/);
    assert.ok(Date.now() - started < 5000, 'timeout must settle without waiting indefinitely for inherited pipes');
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
    assert.equal(processIdentity(pids.parent), null, 'command leader exited');
    assert.equal(processIdentity(pids.pid), null, 'TERM-resistant descendant was killed');
    const ledger = JSON.parse(readFileSync(join(root, 'commands.jsonl'), 'utf8'));
    assert.equal(ledger.failure, 'timeout');
  } finally { rmSync(root, { recursive: true }); }
});

test('reset without confirmation cannot touch an existing preview', () => {
  const result = spawnSync(process.execPath, ['scripts/developer-preview.mjs', 'reset'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 1); assert.match(result.stderr, /--confirm/);
});
