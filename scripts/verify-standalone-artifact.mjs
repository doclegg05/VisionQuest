#!/usr/bin/env node
// Read-only artifact gate. Prints paths/categories, never matching values.
// Run after `npm run build`; only .next/standalone is deployable, not .next/cache.
import { readdirSync, readFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve('.next/standalone');
const findings = [];
for (const path of ['server.js', '.next/static', 'public']) {
  if (!existsSync(join(root, path))) findings.push({ path, category: 'missing-required-artifact' });
}
const canaries = ['JWT_SECRET', 'API_KEY_ENCRYPTION_KEY', 'CRON_SECRET']
  .filter(key => process.env[key])
  .map(key => [key, Buffer.from(process.env[key])]);
let files = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    // Names are forbidden regardless of entry type, including internal symlinks
    // and empty directories. Never let a symlink bypass path screening.
    if (rel.split(/[\\/]/).some(part => part.startsWith('.env') || ['.git', '.codex', 'uploads', 'scratch', 'prototypes'].includes(part)) || /\.test\.[cm]?[jt]sx?$/.test(rel)) {
      findings.push({ path: rel, category: 'private-or-test-artifact' });
    }
    // Turbopack creates internal dependency aliases. Targets are scanned through
    // the normal directory walk; reject broken links or escapes from the bundle.
    if (entry.isSymbolicLink()) {
      try {
        const target = relative(realpathSync(root), realpathSync(path));
        if (target === '..' || target.startsWith(`..${sep}`)) findings.push({ path: rel, category: 'escaping-symlink' });
      } catch { findings.push({ path: rel, category: 'broken-symlink' }); }
      continue;
    }
    if (entry.isDirectory()) { scan(path); continue; }
    if (!entry.isFile()) continue;
    files++;
    // Refuse oversized inputs rather than silently skipping a scan.
    if (statSync(path).size > 256 * 1024 * 1024) { findings.push({ path: rel, category: 'too-large-to-scan' }); continue; }
    const bytes = readFileSync(path);
    for (const [key, value] of canaries) {
      if (bytes.includes(value)) findings.push({ path: rel, category: `environment-canary:${key}` });
    }
    if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(bytes.toString('utf8'))) {
      findings.push({ path: rel, category: 'private-key-marker' });
    }
  }
}
if (existsSync(root)) scan(root);
console.log(JSON.stringify({ files, findings }, null, 2));
if (findings.length) process.exitCode = 1;
