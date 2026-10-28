#!/usr/bin/env node
// Explicit opt-in; never consumes DATABASE_URL, .env, pg service files, or an existing cluster.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

if (process.argv[2] !== '--run-local') {
  console.error('Usage: node scripts/verify-dashboard-rls.mjs --run-local');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
// Prisma can embed dotenv paths when generated elsewhere. Refuse those clients
// before importing them rather than reading any project credential files.
const generated = readFileSync(join(root, 'node_modules/.prisma/client/index.js'), 'utf8');
const envPaths = generated.match(/"relativeEnvPaths":\s*(\{[^}]*\})/);
if (!envPaths || Object.values(JSON.parse(envPaths[1])).some(Boolean)) {
  throw new Error('Generated Prisma client may load dotenv files; cannot safely run this verifier.');
}
const bin = process.env.DASHBOARD_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
// Short socket path for macOS; distinct from all other verification clusters.
const dir = mkdtempSync('/tmp/vq-task-rls-');
const data = join(dir, 'data');
const port = '58371'; // Unix socket only, in our unique directory; no TCP listener.
const marker = randomUUID();
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C', PGCONNECT_TIMEOUT: '5' };
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...extra });
  if (result.error || result.status !== 0) throw new Error(`${command} failed\n${result.error || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
  return result.stdout;
}
const sql = (text) => run(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'dashboard_rls_disposable'], { input: text });
let started = false;
try {
  run(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  run(join(bin, 'createdb'), ['-h', dir, '-p', port, '-U', 'postgres', 'dashboard_rls_disposable']);
  // Supabase platform role names referenced by REVOKE in repository migrations.
  // Inert NOLOGIN roles only: no grants, memberships, or substitute policies.
  sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
  const migrations = readdirSync(join(root, 'prisma/migrations'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  for (const migration of migrations) {
    console.log(`Replay ${migration}`);
    run(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'dashboard_rls_disposable', '-f', resolve(root, 'prisma/migrations', migration, 'migration.sql')]);
  }
  sql(`ALTER ROLE vq_app LOGIN; CREATE TABLE public.dashboard_rls_verification_marker (token text); INSERT INTO public.dashboard_rls_verification_marker VALUES ('${marker}'); GRANT SELECT ON public.dashboard_rls_verification_marker TO vq_app;`);
  writeFileSync(join(dir, 'marker'), marker);
  const url = user => `postgresql://${user}@localhost:${port}/dashboard_rls_disposable?host=${encodeURIComponent(dir)}&schema=visionquest&connection_limit=3`;
  run(process.execPath, ['--import', 'tsx', '--test', '--experimental-test-module-mocks', 'src/lib/dashboard/tasks.db.test.ts'], {
    env: { ...env, NODE_ENV: 'test', DATABASE_URL: url('vq_app'), DIRECT_URL: url('vq_app'), ADMIN_DATABASE_URL: url('postgres'), RLS_CONTEXT_INJECTION: 'true', DISABLE_RLS_CONTEXT_WARN: 'true', DASHBOARD_RLS_DB_TEST: marker, DASHBOARD_RLS_CLUSTER: dir },
    stdio: 'inherit',
  });
  console.log(`Verified ${migrations.length} migrations in isolated PostgreSQL; removing ${dir}`);
} finally {
  if (started) run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
  rmSync(dir, { recursive: true, force: true });
}
