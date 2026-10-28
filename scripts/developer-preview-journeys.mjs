// Explicit synthetic preview checks, not a production/e2e target runner.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { command, environment, ownedFile, privateDirectory, sandbox } from './developer-preview-support.mjs';
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(project, '.developer-preview');
const cleanEnv = environment(runtime, '/opt/homebrew/opt/postgresql@17/bin');
privateDirectory(runtime); ownedFile(join(runtime, 'network.sb'));
assert.equal(readFileSync(join(runtime, 'network.sb'), 'utf8'), sandbox);
if (!process.argv.includes('--sandboxed')) {
  // Re-exec before reading credentials. Browser AND APIRequestContext inherit
  // the OS network boundary; page routing alone cannot constrain API redirects.
  try {
    const result = await command({ project, runtime, env: cleanEnv }, 'journey-runner', [process.execPath, fileURLToPath(import.meta.url), '--sandboxed'], { timeout: 180000 });
    console.log(result.trim());
    process.exit(0);
  } catch (error) { console.error(error.message); process.exit(1); }
}
// Do not trust the internal flag as proof of sandboxing.
await new Promise((resolve, reject) => {
  const socket = net.connect(443, '192.0.2.1');
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('Journey network isolation probe timed out')); }, 2000);
  socket.on('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('Journey remote network is not blocked')); });
  socket.on('error', error => { clearTimeout(timer); if (['EPERM', 'EACCES'].includes(error.code)) resolve(); else reject(new Error('Journey OS network isolation not proven')); });
});
ownedFile(join(runtime, 'owner.json')); ownedFile(join(runtime, 'ready.json')); ownedFile(join(runtime, 'credentials.json'));
const marker = JSON.parse(readFileSync(join(runtime, 'owner.json')));
const ready = JSON.parse(readFileSync(join(runtime, 'ready.json')));
assert.equal(ready.owner, marker.id); assert.equal(marker.uid, process.getuid());
assert.equal(new URL(ready.url).hostname, '127.0.0.1'); assert.equal(new URL(ready.url).protocol, 'https:'); assert.equal(new URL(ready.url).origin, ready.url);
const credentials = JSON.parse(readFileSync(join(runtime, 'credentials.json')));
const require = createRequire(join(runtime, 'snapshot/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking'], env: cleanEnv, headless: true });
const evidence = { url: ready.url, networkIsolation: 'OS sandbox remote-denial probe PASS; sanitized runner/browser environment; API redirects disabled', journeys: {}, violations: [], exceptions: [], browser: [] };
const contexts = [];
async function context(account) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); contexts.push(ctx);
  await ctx.route('**/*', route => new URL(route.request().url()).origin === ready.url ? route.continue() : route.abort());
  const response = await ctx.request.post(`${ready.url}/api/auth/login`, { maxRedirects: 0, headers: { origin: ready.url }, data: { studentId: account.login, password: account.password } });
  assert.equal(response.status(), 200, 'Normal synthetic login');
  assert.ok((await ctx.cookies()).some(cookie => cookie.secure && cookie.httpOnly));
  return ctx;
}
async function api(ctx, path, method = 'GET', data, expected = 200) {
  const res = await ctx.request.fetch(`${ready.url}${path}`, { method, maxRedirects: 0, headers: { origin: ready.url }, ...(data ? { data } : {}), timeout: 15000 });
  assert.equal(res.status(), expected, `${method} ${path}`);
  return res.json();
}
async function journey(name, fn) { try { evidence.journeys[name] = await fn(); } catch (error) { evidence.journeys[name] = { status: 'BLOCKED', reason: error.message }; } }
try {
  const student = await context(credentials.accounts[0]);
  const second = await context(credentials.accounts[1]);
  const teacher = await context(credentials.accounts[2]);
  await journey('isolation', async () => {
    const task = (await api(student, '/api/tasks', 'POST', { title: 'Synthetic preview persistence probe' }, 201)).task;
    await api(second, `/api/tasks/${task.id}`, 'PATCH', { status: 'completed', updatedAt: task.updatedAt }, 404);
    const noauth = await browser.newContext({ ignoreHTTPSErrors: true }); contexts.push(noauth);
    assert.equal((await noauth.request.get(`${ready.url}/api/tasks`, { maxRedirects: 0 })).status(), 401);
    assert.equal((await student.request.get(`${ready.url}/api/dev-login?role=admin`, { maxRedirects: 0 })).status(), 404);
    assert.equal((await student.request.post(`${ready.url}/api/tasks`, { maxRedirects: 0, headers: { origin: 'https://foreign.invalid' }, data: { title: 'must fail' } })).status(), 403);
    for (const path of ['overview', 'activity', 'support']) await api(student, `/api/dashboard/${path}`);
    return { status: 'PASS', taskId: task.id, steps: 'Normal secure-cookie login, persisted task, second-student rejection, unauthenticated rejection, CSRF, dev-login 404, dashboard APIs' };
  });
  await journey('skills', async () => {
    await api(student, '/api/goals', 'POST', { level: 'monthly', content: 'Synthetic preview: improve computer skills and explore IT support' }, 201);
    const platforms = await api(student, '/api/lms/platforms');
    assert.ok(platforms.platforms.length); const platform = platforms.platforms.find(p => platforms.goalMatches.includes(p.id)) || platforms.platforms[0];
    await api(student, '/api/lms/platforms/visit', 'POST', { platformId: platform.id });
    const progress = await api(student, '/api/progression');
    assert.ok(progress.platformsVisited.includes(platform.id));
    return { status: 'LIMITED', steps: 'Goal created; existing platform catalog/matching read; platform visit recorded and progression read. External learning completion not verified.', platform: platform.id, progressionResponseKeys: Object.keys(progress) };
  });
  await journey('ready-to-work', async () => {
    const cert = await api(student, '/api/certifications');
    const requirement = cert.requirements.find(r => !r.needsFile && r.needsVerify);
    assert.ok(requirement, 'Existing non-file instructor-reviewed requirement');
    await api(student, '/api/certifications', 'POST', { requirementId: requirement.id, completed: true, notes: 'SYNTHETIC PREVIEW evidence: developer exercised this requirement; not a participant outcome.' });
    await api(second, '/api/certifications', 'POST', { requirementId: requirement.id, notes: 'must not change' }, 404);
    await api(teacher, '/api/teacher/certifications', 'PUT', { requirementId: requirement.id, verified: true });
    const reread = await api(student, '/api/certifications');
    assert.ok(reread.requirements.find(r => r.id === requirement.id).verifiedBy);
    assert.notEqual(reread.certification.status, 'completed');
    return { status: 'LIMITED', requirement: requirement.label, steps: 'Existing requirement → synthetic textual evidence → authorized instructor review → persisted verified requirement. File uploads unavailable; full certification not earned or validated.' };
  });
  await journey('employment', async () => {
    await api(student, '/api/resume', 'POST', { resume: { headline: 'Synthetic preview IT support applicant', skills: ['Synthetic computer skills'] } });
    assert.equal((await api(student, '/api/resume')).resume.headline, 'Synthetic preview IT support applicant');
    const opportunity = (await api(teacher, '/api/teacher/opportunities', 'POST', { title: 'Synthetic preview IT support role', company: 'Synthetic Company — not recruiting', type: 'job', url: 'https://example.invalid/preview' })).opportunity;
    const application = await api(student, '/api/applications', 'POST', { opportunityId: opportunity.id, status: 'applied', notes: 'Synthetic local application record only; nothing submitted externally.' });
    const records = await api(student, '/api/opportunities');
    return { status: 'LIMITED', steps: 'Resume saved/read, instructor-created synthetic job, self-reported application recorded, opportunities reread. No external submission/placement.', applicationResponseKeys: Object.keys(application), recordsResponseKeys: Object.keys(records) };
  });
  await journey('education', async () => {
    await api(student, '/api/goals', 'POST', { level: 'monthly', content: 'Synthetic preview: explore college education and financial aid' }, 201);
    const platforms = await api(student, '/api/lms/platforms');
    return { status: 'LIMITED', steps: 'Education planning goal persisted; existing platform/program catalog available. No supported enrollment transaction verified; do not call this enrollment validation.', catalogEntries: platforms.platforms.length };
  });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await student.setDefaultTimeout(15000);
    const page = await student.newPage(); await page.setViewportSize(viewport);
    await page.exposeFunction('capturePreviewCSP', event => evidence.violations.push(event));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.capturePreviewCSP({ directive: e.effectiveDirective, blockedURI: e.blockedURI, sourceFile: e.sourceFile, line: e.lineNumber, column: e.columnNumber, sample: e.sample })));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${ready.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.locator('h1').first().waitFor();
    await page.waitForTimeout(1500);
    assert.deepEqual(errors, []);
    assert.match(page.url(), /\/dashboard$/); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(runtime, `dashboard-${viewport.width}.png`), fullPage: true });
    evidence.browser.push({ width: viewport.width, status: 'PASS', pageErrors: errors, headings: await page.locator('h1,h2').allTextContents() });
    await page.close();
  }
} finally {
  writeFileSync(join(runtime, 'journey-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  for (const context of contexts) await context.close(); await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
