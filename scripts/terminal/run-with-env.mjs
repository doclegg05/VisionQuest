#!/usr/bin/env node
// Run one npm script with .env.local loaded, for jobs the Claude Code session
// sandbox cannot run (it cannot read .env.local or reach some hosts).
// Usage: node scripts/terminal/run-with-env.mjs [--yes] <npm-script> [args...]
// Prints the target DB host (never credentials) and saves output to
// reports/terminal/<UTC timestamp>-<script>.log under the current directory.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const SCRIPT_NAME = /^[a-z0-9:_-]+$/;
const USAGE = 'Usage: node scripts/terminal/run-with-env.mjs [--yes] <npm-script> [args...]';

function fail(message) {
  console.error(message);
  process.exit(2);
}

export function describeDbHost(databaseUrl) {
  if (!databaseUrl) return '(DATABASE_URL not set)';
  try {
    return new URL(databaseUrl).hostname || '(unparseable)';
  } catch {
    return '(unparseable)';
  }
}

export function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => {
      rl.close();
      resolve();
    });
    rl.once('close', resolve);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const skipPause = argv[0] === '--yes';
  const rest = skipPause ? argv.slice(1) : argv;
  const [script, ...afterScript] = rest;
  // The runner adds its own "--" before pass-through args, so drop one the
  // caller typed to avoid handing npm a doubled "--".
  const passArgs = afterScript[0] === '--' ? afterScript.slice(1) : afterScript;

  if (!script || !SCRIPT_NAME.test(script)) fail(USAGE);

  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    fail('.env.local not found. Run this from the repo root.');
  }
  process.loadEnvFile(envPath);

  console.log(`Target DB host: ${describeDbHost(process.env.DATABASE_URL)}`);

  if (!skipPause) {
    console.log('Press Enter to continue, or Ctrl+C to stop.');
    await waitForEnter();
  }

  const logRel = path.join('reports', 'terminal', `${utcStamp(new Date())}-${script}.log`);
  const logAbs = path.join(process.cwd(), logRel);
  fs.mkdirSync(path.dirname(logAbs), { recursive: true });
  const log = fs.createWriteStream(logAbs);

  const npmArgs = ['run', script, ...(passArgs.length ? ['--', ...passArgs] : [])];
  const child = spawn('npm', npmArgs, {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    log.write(chunk);
  });

  const code = await new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`Could not start npm: ${err.message}`);
      resolve(127);
    });
    child.on('close', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });

  await new Promise((resolve) => log.end(resolve));
  console.log(`Log: ${logRel}`);
  process.exit(code);
}

main();
