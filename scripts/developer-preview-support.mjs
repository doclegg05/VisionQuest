import { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, realpathSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';

export const hash = data => createHash('sha256').update(data).digest('hex');
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export function saveJSON(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}
export function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error(`Unsafe private directory: ${path}`);
}
export function ownedFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error(`Unsafe private file: ${path}`);
}
export function contained(root, path) {
  const rel = relative(realpathSync(root), realpathSync(path));
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root) === resolve(path)) throw new Error('Path escapes owned root or selects root itself');
  return path;
}
export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  const p = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'uid=', '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 3000 });
  const identity = p.status === 0 ? p.stdout.trim() : '';
  return identity && Number(identity.split(/\s/)[0]) === process.getuid() ? identity : null;
}
export function processMatches(record) { return Boolean(record?.pid && record.identity && processIdentity(record.pid) === record.identity); }
export function assertProcess(record) {
  if (!processMatches(record)) throw new Error('Process identity is stale or foreign; refusing to signal it');
}
export function environment(runtime, pgBin) {
  return {
    PATH: `${dirname(process.execPath)}:${pgBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(runtime, 'home'), TMPDIR: join(runtime, 'tmp'), LANG: 'en_US.UTF-8', CI: '1',
    NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1', PRISMA_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true',
    npm_config_userconfig: '/dev/null', npm_config_globalconfig: join(runtime, 'home', 'empty-global.npmrc'), npm_config_cache: join(runtime, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/',
    DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/preview', DIRECT_URL: 'postgresql://synthetic@127.0.0.1:1/preview',
  };
}
export function requireHost(platform, nodeVersion, paths, exists = existsSync) {
  if (platform !== 'darwin' || Number(nodeVersion.split('.')[0]) !== 24) throw new Error('Preview requires macOS and Node 24');
  for (const path of paths) if (!exists(path)) throw new Error(`Missing prerequisite: ${path}`);
}
export const sandbox = `(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:*") (remote unix-socket))
(allow network-inbound (local ip "localhost:*") (local unix-socket))
(allow network-bind (local ip "localhost:*") (local unix-socket))
`;
export async function command(ctx, label, args, { cwd = ctx.project, env = ctx.env, input, timeout = 120000, isolated = true } = {}) {
  const argv = isolated ? ['/usr/bin/sandbox-exec', '-f', join(ctx.runtime, 'network.sb'), ...args] : args;
  const started = Date.now();
  return new Promise((res, rej) => {
    // A fresh session/process group belongs exclusively to this invocation.
    // Never signal an inherited group, a port owner, or a persisted bare PID.
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let stdout = ''; let timer; let escalation; let drain;
    let settled = false; let failure;
    const finish = code => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(escalation); clearTimeout(drain);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      // Private logs can contain synthetic query details. Never echo them or credentials.
      writeFileSync(join(ctx.runtime, 'logs', `${label}.log`), output, { mode: 0o600 });
      const ledger = join(ctx.runtime, 'commands.jsonl');
      writeFileSync(ledger, JSON.stringify({ label, executable: args[0], args: args.slice(1), code, failure, milliseconds: Date.now() - started }) + '\n', { flag: 'a', mode: 0o600 });
      if (code === 0 && !failure) res(stdout); else rej(new Error(`${label} failed (${failure || `exit ${code}`}); private log: ${join(ctx.runtime, 'logs', `${label}.log`)}`));
    };
    const signalGroup = signal => {
      if (!Number.isSafeInteger(child.pid) || child.pid < 2) return;
      try { process.kill(-child.pid, signal); } catch (error) {
        if (error.code !== 'ESRCH') failure = `owned process-group cleanup failed: ${error.code}`;
      }
    };
    const terminate = reason => {
      if (failure || settled) return;
      failure = reason;
      signalGroup('SIGTERM');
      // Even if the leader exits, descendants may retain pipes or ignore TERM.
      // Keep escalation alive until the whole dedicated group has been killed.
      escalation = setTimeout(() => {
        signalGroup('SIGKILL');
        drain = setTimeout(() => finish(null), 200);
      }, 1000);
    };
    const append = bytes => {
      if (output.length + bytes.length > 8_000_000) { terminate('output limit exceeded'); return; }
      output += bytes.toString();
    };
    child.stdout.on('data', bytes => { append(bytes); if (!failure) stdout += bytes.toString(); }); child.stderr.on('data', append);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') terminate('stdin failure'); });
    child.on('error', () => { failure = 'spawn failed'; finish(null); });
    child.on('close', code => { if (!failure) finish(code); });
    timer = setTimeout(() => terminate('timeout'), timeout);
    child.stdin.end(input);
  });
}
export async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export async function toolingProxy() {
  const permitted = new Set(['registry.npmjs.org:443', 'binaries.prisma.sh:443', 'fonts.googleapis.com:443', 'fonts.gstatic.com:443']);
  const sockets = new Set();
  const server = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', (req, client, head) => {
    if (!permitted.has(req.url)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const remote = net.connect(443, req.url.split(':')[0]); sockets.add(remote); remote.on('close', () => sockets.delete(remote));
    remote.setTimeout(30000, () => remote.destroy());
    remote.on('error', () => client.destroy()); client.on('error', () => remote.destroy());
    remote.on('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); client.pipe(remote); remote.pipe(client); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
const ROOTS = ['src/', 'types/', 'prisma/', 'scripts/', 'public/', 'catalog/', 'e2e/'];
const FILES = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'eslint.config.mjs', 'postcss.config.mjs', 'playwright.config.ts', 'sentry.client.config.ts', 'sentry.edge.config.ts', 'sentry.server.config.ts'];
const CONFIG = ['catalog-allowlist', 'form-routing.generated', 'sage-agent-eval', 'sage-budget', 'sage-chat-eval', 'sage-form-eval', 'sage-model-bakeoff', 'sage-overrides', 'sage-quality-eval', 'sage-rag-curated-notes-day2', 'sage-rag-curated-notes', 'sage-rag-eval', 'sage-rag-top-questions', 'sage-redteam-eval', 'sage-slo', 'ui-readability-allowlist'].map(name => `config/${name}.json`);
export function sourceFiles(project, forms) {
  const p = spawnSync('/usr/bin/git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: project, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10000 });
  if (p.status !== 0) throw new Error('Cannot enumerate working-tree source');
  const files = [...new Set(p.stdout.split('\0').filter(Boolean))];
  const tracked = new Set(spawnSync('/usr/bin/git', ['ls-files', '-z'], { cwd: project, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10000 }).stdout.split('\0'));
  const selectedForms = forms.map(form => {
    const candidates = [form.storageKey, form.storageKey.replace(/^teachers\/guides\//, 'teachers/').replace(/^students\/resources\//, 'students/')];
    const rel = candidates.map(x => `docs-upload/${x}`).find(x => tracked.has(x) && existsSync(join(project, x)));
    if (!rel) throw new Error(`Missing catalog-selected tracked blank form: ${form.id}`);
    const diff = spawnSync('/usr/bin/git', ['diff', 'HEAD', '--exit-code', '--', rel], { cwd: project, env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', timeout: 10000 });
    if (diff.status !== 0) throw new Error(`Official template modified; explicit blank-template review required: ${rel}`);
    return rel;
  });
  const selected = files.filter(rel => ROOTS.some(root => rel.startsWith(root)) || FILES.includes(rel) || CONFIG.includes(rel));
  return [...new Set([...selected, ...selectedForms])].sort().filter(rel => {
    if (rel.split('/').some(part => part.startsWith('.env') || ['node_modules', '.next', 'uploads', '.git'].includes(part))) return false;
    const path = join(project, rel);
    if (!existsSync(path)) return false; // preserve deletions
    // Reject directory symlink traversal, not only the leaf.
    const real = realpathSync(path);
    if (real !== path || !lstatSync(path).isFile()) throw new Error(`Symlink or non-regular snapshot input refused: ${rel}`);
    return true;
  }).map(rel => ({ path: rel, sha256: hash(readFileSync(join(project, rel))) }));
}
export function snapshot(project, destination, manifest) {
  mkdirSync(destination, { mode: 0o700 });
  for (const item of manifest) {
    const from = join(project, item.path), to = join(destination, item.path);
    if (hash(readFileSync(from)) !== item.sha256) throw new Error('Inputs changed during snapshot; retry');
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); copyFileSync(from, to);
  }
}
export function noDotenv(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.env')) throw new Error('Dotenv file found in isolated snapshot');
    if (entry.isDirectory() && !['node_modules', '.next'].includes(entry.name)) noDotenv(join(dir, entry.name));
  }
}
