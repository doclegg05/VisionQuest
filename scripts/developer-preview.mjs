#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, lstatSync, openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import https from 'node:https';
import { hash, readJSON, saveJSON, privateDirectory, ownedFile, processIdentity, processMatches, assertProcess, environment, sandbox, command, availablePort, toolingProxy, sourceFiles, snapshot, noDotenv, requireHost } from './developer-preview-support.mjs';

const project = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const runtime = join(project, '.developer-preview');
const action = process.argv[2] || 'start';
const pgBin = '/opt/homebrew/opt/postgresql@17/bin';
const openssl = '/opt/homebrew/opt/openssl@3/bin/openssl';
const ctx = { project, runtime, env: environment(runtime, pgBin) };
const statePath = join(runtime, 'state.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function ownership() {
  privateDirectory(runtime); ownedFile(join(runtime, 'owner.json'));
  const marker = readJSON(join(runtime, 'owner.json'));
  if (marker.project !== project || marker.uid !== process.getuid() || marker.version !== 1 || !/^[a-f0-9-]{36}$/.test(marker.id)) throw new Error('Preview ownership marker mismatch');
  if (!marker.socket.startsWith(`/private/tmp/vqp-${process.getuid()}-`) || dirname(marker.socket) !== '/private/tmp') throw new Error('Unsafe socket directory');
  privateDirectory(marker.socket); ownedFile(join(marker.socket, 'owner.json'));
  if (readJSON(join(marker.socket, 'owner.json')).id !== marker.id || realpathSync(marker.socket) !== marker.socket) throw new Error('Socket owner mismatch');
  for (const path of ['home', 'tmp', 'logs']) privateDirectory(join(runtime, path));
  for (const path of ['credentials.json', 'state.json']) if (existsSync(join(runtime, path))) ownedFile(join(runtime, path));
  return marker;
}
function initialize() {
  if (existsSync(runtime)) return ownership();
  privateDirectory(runtime);
  const socket = realpathSync(mkdtempSync(`/tmp/vqp-${process.getuid()}-`));
  const marker = { version: 1, id: randomUUID(), project, uid: process.getuid(), socket };
  saveJSON(join(runtime, 'owner.json'), marker); saveJSON(join(socket, 'owner.json'), { id: marker.id });
  for (const dir of ['home', 'tmp', 'logs']) privateDirectory(join(runtime, dir));
  const secret = () => randomBytes(32).toString('base64url');
  saveJSON(join(runtime, 'credentials.json'), { jwt: secret(), encryption: randomBytes(32).toString('base64'), cron: secret(), storage: secret(), accounts: [
    { login: 'preview-student', name: 'Synthetic Preview Student', role: 'student', password: secret() },
    { login: 'preview-second', name: 'Synthetic Second Student', role: 'student', password: secret() },
    { login: 'preview-instructor', name: 'Synthetic Preview Instructor', role: 'teacher', password: secret() },
  ] });
  saveJSON(statePath, {});
  writeFileSync(join(runtime, 'baseline-status.txt'), spawnSync('/usr/bin/git', ['status', '--short'], { cwd: project, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).stdout, { mode: 0o600 });
  return marker;
}
async function prerequisites() {
  requireHost(process.platform, process.versions.node, ['/usr/bin/sandbox-exec', openssl, ...['initdb', 'postgres', 'pg_ctl', 'psql', 'createdb', 'pg_config'].map(x => join(pgBin, x))]);
  const version = await command(ctx, 'postgres-version', [join(pgBin, 'postgres'), '--version']);
  if (!version.includes(' 17.')) throw new Error('PostgreSQL 17 is required');
  const share = (await command(ctx, 'postgres-share', [join(pgBin, 'pg_config'), '--sharedir'])).trim();
  if (!existsSync(join(share, 'extension/vector.control'))) throw new Error('Missing PostgreSQL 17 pgvector extension');
  await command(ctx, 'openssl-version', [openssl, 'version']);
  await command(ctx, 'network-isolation-probe', [process.execPath, '--input-type=module', '-e', `import net from 'node:net'; const s=net.connect(443,'192.0.2.1'); s.on('connect',()=>process.exit(1)); s.on('error',e=>process.exit(['EPERM','EACCES'].includes(e.code)?0:2)); setTimeout(()=>process.exit(3),2000);`], { timeout: 5000 });
}
async function manifest() {
  const json = await command(ctx, 'forms-catalog', [process.execPath, '--input-type=module', '-e', `import { FORMS } from './src/lib/spokes/forms.ts'; console.log(JSON.stringify(FORMS.filter(f=>f.storageKey)));`]);
  const files = sourceFiles(project, JSON.parse(json));
  return { files, fingerprint: hash(JSON.stringify(files)), rules: 'Current git tracked + untracked intended src/types/prisma/scripts/public/catalog; explicit root/config files; official catalog-selected tracked unmodified blank templates. No dotenv/dependencies/builds/uploads or symlinks.' };
}
async function build(state, inputs) {
  const work = join(runtime, 'snapshot');
  if (state.fingerprint === inputs.fingerprint && existsSync(join(work, '.next/standalone/server.js'))) return work;
  // Only this marked preview snapshot is replaced; PostgreSQL and credentials persist.
  if (existsSync(work)) { if (lstatSync(work).isSymbolicLink()) throw new Error('Snapshot symlink refused'); rmSync(work, { recursive: true }); }
  snapshot(project, work, inputs.files); noDotenv(work);
  const proxy = await toolingProxy();
  const env = { ...ctx.env, HTTPS_PROXY: proxy.url, HTTP_PROXY: proxy.url, npm_config_https_proxy: proxy.url, npm_config_proxy: proxy.url };
  console.log('Building current source in the private snapshot; only allowlisted tooling downloads are permitted.');
  try {
    await command(ctx, 'npm-ci', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, env, timeout: 240000 });
    await command(ctx, 'prisma-generate', [process.execPath, 'node_modules/prisma/build/index.js', 'generate'], { cwd: work, env });
    await command(ctx, 'prisma-validate', [process.execPath, 'node_modules/prisma/build/index.js', 'validate'], { cwd: work });
    await command(ctx, 'blank-forms-screen', [process.execPath, '--input-type=module', '-e', `import {PDFDocument} from 'pdf-lib'; import fs from 'node:fs'; const files=JSON.parse(fs.readFileSync('../inputs.json')).files.filter(f=>f.path.startsWith('docs-upload/')); for(const f of files){const p=await PDFDocument.load(fs.readFileSync(f.path));for(const field of p.getForm().getFields()){if(field.getText?.()?.trim() || field.isChecked?.() || field.getSelected?.()?.length)throw Error('Nonblank official form: '+f.path);}}console.log('Blank field screening passed',files.length);`], { cwd: work });
    await command(ctx, 'build', ['npm', 'run', 'build'], { cwd: work, env, timeout: 240000 });
  } finally { proxy.close(); }
  const after = await manifest();
  if (after.fingerprint !== inputs.fingerprint) throw new Error('Source changed during build; rerun preview:local (stale artifact not launched).');
  state.fingerprint = inputs.fingerprint; saveJSON(statePath, state);
  return work;
}
function dbURL(marker, state, user) { return `postgresql://${user}@localhost:${state.pgPort}/vq_preview?host=${encodeURIComponent(marker.socket)}&schema=visionquest&connection_limit=3`; }
async function sql(marker, state, text, database = 'vq_preview') {
  return command(ctx, 'postgres-query', [join(pgBin, 'psql'), '-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', marker.socket, '-p', String(state.pgPort), '-U', 'postgres', '-d', database], { input: text });
}
async function database(marker, state, work) {
  const data = join(runtime, 'pg');
  if (existsSync(data) && lstatSync(data).isSymbolicLink()) throw new Error('Database directory symlink refused');
  if (!existsSync(data)) {
    state.pgPort = await availablePort(); saveJSON(statePath, state);
    await command(ctx, 'initdb', [join(pgBin, 'initdb'), '-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  }
  if (state.pg && processIdentity(state.pg.pid) && !processMatches(state.pg)) throw new Error('Foreign/stale PostgreSQL identity; refusing to adopt it');
  if (!processMatches(state.pg)) {
    if (existsSync(join(data, 'postmaster.pid'))) throw new Error('Unowned postmaster.pid; inspect private cluster before recovery');
    await command(ctx, 'postgres-start', [join(pgBin, 'pg_ctl'), '-D', data, '-l', join(runtime, 'logs/postgres.log'), '-o', `-k ${marker.socket} -p ${state.pgPort} -c listen_addresses=''`, '-w', 'start']);
    const pid = Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0]);
    state.pg = { pid, identity: processIdentity(pid) };
    if (!state.pg.identity?.includes(data)) throw new Error('PostgreSQL process identity mismatch');
    saveJSON(statePath, state);
  }
  if (!state.databaseCreated) {
    await command(ctx, 'createdb', [join(pgBin, 'createdb'), '-h', marker.socket, '-p', String(state.pgPort), '-U', 'postgres', 'vq_preview']);
    await sql(marker, state, 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
    state.databaseCreated = true; saveJSON(statePath, state);
  }
  const env = { ...ctx.env, DATABASE_URL: dbURL(marker, state, 'postgres'), DIRECT_URL: dbURL(marker, state, 'postgres') };
  const exists = await sql(marker, state, `SELECT to_regclass('visionquest._prisma_migrations') IS NOT NULL;`);
  if (exists.trim() === 't') {
    const applied = await sql(marker, state, 'SELECT migration_name || \'|\' || checksum || \'|\' || (finished_at IS NOT NULL)::text FROM visionquest._prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name;');
    for (const line of applied.trim().split('\n').filter(Boolean)) {
      const [name, checksum, finished] = line.split('|');
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid applied migration name');
      const path = join(work, 'prisma/migrations', name, 'migration.sql');
      if (finished !== 'true' || !existsSync(path) || hash(readFileSync(path)) !== checksum) throw new Error(`Applied migration changed or incomplete: ${name}. No automatic reset; review or explicitly reset preview data.`);
    }
  }
  await command(ctx, 'migrate-deploy', [process.execPath, 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: work, env });
  if (!state.seeded) {
    if (state.seedStarted) throw new Error('Initial seed was interrupted; explicit reset/review required, never overwrite existing synthetic progress');
    state.seedStarted = true; saveJSON(statePath, state);
    await command(ctx, 'official-requirements-seed', [process.execPath, '--import', 'tsx', 'scripts/seed-data.mjs'], { cwd: work, env });
    await command(ctx, 'synthetic-account-seed', [process.execPath, '--import', 'tsx', 'scripts/developer-preview-seed.ts', runtime], { cwd: work, env });
    await sql(marker, state, `ALTER ROLE vq_app LOGIN; CREATE ROLE vq_preview_preauth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT USAGE ON SCHEMA visionquest TO vq_preview_preauth;
GRANT SELECT, UPDATE ON visionquest."Student" TO vq_preview_preauth;
GRANT SELECT, INSERT, UPDATE, DELETE ON visionquest."RateLimitEntry" TO vq_preview_preauth;
GRANT SELECT, INSERT ON visionquest."AuditLog" TO vq_preview_preauth;
GRANT SELECT ON visionquest."SystemConfig", visionquest."SecurityQuestionAnswer" TO vq_preview_preauth;`);
    state.seeded = true; saveJSON(statePath, state);
  }
}
async function stop(state) {
  if (state.worker) {
    if (processIdentity(state.worker.pid)) {
      if (!state.worker.identity?.includes(join(project, 'scripts/developer-preview-worker.mjs')) || !state.worker.identity.includes(runtime)) throw new Error('Worker command mismatch');
      assertProcess(state.worker); process.kill(state.worker.pid, 'SIGTERM');
      for (let i = 0; i < 100 && processMatches(state.worker); i++) await delay(100);
      if (processMatches(state.worker)) throw new Error('Owned worker did not stop; refusing unsafe escalation');
    }
    delete state.worker;
  }
  // Recover an orphaned child only from its private, owner-bound identity record.
  const childrenPath = join(runtime, 'children.json');
  if (existsSync(childrenPath)) {
    ownedFile(childrenPath);
    const children = readJSON(childrenPath);
    if (children.owner !== ownership().id) throw new Error('Child ownership mismatch');
    if (children.app && processIdentity(children.app.pid)) {
      if (children.app.launchPath !== join(runtime, 'snapshot/.next/standalone/server.js')) throw new Error('Standalone command mismatch');
      assertProcess(children.app); process.kill(children.app.pid, 'SIGTERM');
      for (let i = 0; i < 100 && processMatches(children.app); i++) await delay(100);
      if (processMatches(children.app)) throw new Error('Owned standalone child did not stop');
    }
    rmSync(childrenPath);
  }
  if (state.pg) {
    if (processIdentity(state.pg.pid)) {
      if (!state.pg.identity?.includes(join(runtime, 'pg'))) throw new Error('PostgreSQL command mismatch');
      assertProcess(state.pg);
      const data = join(runtime, 'pg');
      if (lstatSync(data).isSymbolicLink() || Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0]) !== state.pg.pid) throw new Error('Postmaster identity mismatch');
      await command(ctx, 'postgres-stop', [join(pgBin, 'pg_ctl'), '-D', data, '-m', 'fast', '-w', 'stop']);
    }
    delete state.pg;
  }
  delete state.url; saveJSON(statePath, state);
}
async function readiness(state) {
  if (!processMatches(state.worker) || !processMatches(state.pg)) throw new Error('Preview processes are not healthy/owned');
  const marker = ownership();
  ownedFile(join(runtime, 'runtime-env.json'));
  const env = readJSON(join(runtime, 'runtime-env.json'));
  if (env.DATABASE_URL !== dbURL(marker, state, 'vq_app') || env.DIRECT_URL !== env.DATABASE_URL || env.ADMIN_DATABASE_URL !== dbURL(marker, state, 'vq_preview_preauth') || env.RLS_CONTEXT_INJECTION !== 'true' || env.RLS_CONTEXT_STRICT !== 'true') throw new Error('Runtime connection/isolation configuration mismatch');
  ownedFile(join(runtime, 'children.json'));
  const children = readJSON(join(runtime, 'children.json'));
  if (children.owner !== marker.id || children.app?.launchPath !== join(runtime, 'snapshot/.next/standalone/server.js')) throw new Error('Standalone ownership mismatch');
  // macOS refuses execution of setuid /bin/ps inside a sandbox. Bind the
  // identity here, outside it, only after proving this is the worker's child.
  if (!children.app.identity) {
    const parent = spawnSync('/bin/ps', ['-p', String(children.app.pid), '-o', 'ppid='], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 3000 });
    if (parent.status !== 0 || Number(parent.stdout.trim()) !== state.worker.pid) throw new Error('Standalone parent process mismatch');
    children.app.identity = processIdentity(children.app.pid);
    saveJSON(join(runtime, 'children.json'), children);
  }
  if (!processMatches(children.app)) throw new Error('Standalone process is not healthy/owned');
  const roles = await sql(marker, state, `SELECT rolname || '|' || rolsuper || '|' || rolbypassrls FROM pg_roles WHERE rolname IN ('vq_app','vq_preview_preauth') ORDER BY rolname;`);
  if (roles.trim() !== ['vq_app|false|false', 'vq_preview_preauth|false|true'].join('\n')) throw new Error('Local database role flags differ from preview contract');
  ownedFile(join(runtime, 'ready.json'));
  const ready = readJSON(join(runtime, 'ready.json'));
  const url = new URL(ready.url);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || ready.owner !== ownership().id) throw new Error('Invalid preview readiness marker');
  const status = await new Promise((resolve, reject) => {
    const req = https.get(`${url.origin}/api/dev-login?role=admin`, { ca: readFileSync(join(runtime, 'localhost.crt')), timeout: 5000 }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Readiness timeout')));
  });
  if (status !== 404) throw new Error('Dev-login retirement readiness failed');
  return url.origin;
}
async function main() {
  if (!['start', 'check', 'stop', 'reset'].includes(action)) throw new Error('Usage: developer-preview.mjs start|check|stop|reset --confirm');
  if (action === 'reset' && !process.argv.includes('--confirm')) throw new Error('Reset destroys only synthetic preview data; repeat with --confirm');
  if (!existsSync(runtime) && action !== 'start') { console.log('No local preview exists. Run npm run preview:local.'); return; }
  const marker = initialize();
  if (existsSync(join(runtime, 'network.sb'))) ownedFile(join(runtime, 'network.sb'));
  writeFileSync(join(runtime, 'network.sb'), sandbox, { mode: 0o600 });
  const lock = join(runtime, 'operation.lock');
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw new Error('Another preview operation or stale lock exists. Inspect operation.lock and process identity; never delete a live lock.'); }
  writeFileSync(fd, JSON.stringify({ owner: marker.id, pid: process.pid, identity: processIdentity(process.pid) })); closeSync(fd);
  try {
    const state = readJSON(statePath);
    if (action === 'stop' || action === 'reset') {
      await stop(state);
      if (action === 'reset') {
        ownership(); rmSync(marker.socket, { recursive: true }); rmSync(runtime, { recursive: true });
        console.log('Removed only this marked preview and its synthetic data.');
      } else console.log('Owned preview stopped. Synthetic data and credentials retained.');
      return;
    }
    await prerequisites();
    const inputs = await manifest();
    if (action === 'check') {
      if (state.fingerprint !== inputs.fingerprint) throw new Error('Source inputs changed; run preview:local to rebuild. Current artifact is stale.');
      console.log(`Healthy owned synthetic preview: ${await readiness(state)}`); return;
    }
    if (processMatches(state.worker) && state.fingerprint === inputs.fingerprint) { console.log(`Synthetic preview: ${await readiness(state)}`); return; }
    await stop(state);
    saveJSON(join(runtime, 'inputs.json'), inputs);
    const work = await build(state, inputs);
    await database(marker, state, work);
    if (!existsSync(join(runtime, 'localhost.key'))) {
      await command(ctx, 'localhost-certificate', [openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(runtime, 'localhost.key'), '-out', join(runtime, 'localhost.crt'), '-days', '30', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    }
    ownedFile(join(runtime, 'localhost.key'));
    const secrets = readJSON(join(runtime, 'credentials.json'));
    saveJSON(join(runtime, 'runtime-env.json'), { ...ctx.env, DATABASE_URL: dbURL(marker, state, 'vq_app'), DIRECT_URL: dbURL(marker, state, 'vq_app'), ADMIN_DATABASE_URL: dbURL(marker, state, 'vq_preview_preauth'), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', JWT_SECRET: secrets.jwt, API_KEY_ENCRYPTION_KEY: secrets.encryption, CRON_SECRET: secrets.cron, RLS_CONTEXT_INJECTION: 'true', RLS_CONTEXT_STRICT: 'true', SAGE_AGENT_MODE: 'off', SAGE_AGENT_ENABLED: 'false', STORAGE_ACCESS_KEY: 'synthetic-preview', STORAGE_SECRET_KEY: secrets.storage, STORAGE_BUCKET: 'synthetic-preview', STORAGE_REGION: 'us-east-1' });
    if (existsSync(join(runtime, 'ready.json'))) rmSync(join(runtime, 'ready.json'));
    const log = openSync(join(runtime, 'logs/worker.log'), 'a', 0o600);
    const child = spawn('/usr/bin/sandbox-exec', ['-f', join(runtime, 'network.sb'), process.execPath, join(project, 'scripts/developer-preview-worker.mjs'), runtime, marker.id], { cwd: work, env: ctx.env, detached: true, stdio: ['ignore', log, log] });
    child.unref(); closeSync(log);
    await delay(200);
    state.worker = { pid: child.pid, identity: processIdentity(child.pid) }; saveJSON(statePath, state);
    for (let i = 0; i < 120; i++) {
      if (!processMatches(state.worker)) throw new Error('Preview worker exited; see private logs/worker.log');
      if (existsSync(join(runtime, 'ready.json'))) { state.url = await readiness(state); saveJSON(statePath, state); console.log(`Synthetic developer preview ready: ${state.url}\nSelf-signed certificate: accept only this localhost warning; system trust is unchanged.\nCredentials retrieval (do not paste into logs): cat '${join(runtime, 'credentials.json')}'\nAI/cloud services unavailable; private local uploads persist; official blank form fallback enabled.`); return; }
      await delay(250);
    }
    throw new Error('Preview startup timed out; run preview:stop and inspect private logs');
  } finally { if (existsSync(lock)) rmSync(lock); }
}
process.umask(0o077);
main().catch(error => { console.error(`Preview: ${error.message}`); process.exitCode = 1; });
