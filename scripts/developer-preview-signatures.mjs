// Synthetic HTTP integration only. Never uses the developer's drawn signature.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import net from 'node:net';
import { command, environment, privateDirectory, ownedFile, readJSON, saveJSON, sandbox } from './developer-preview-support.mjs';
const project = dirname(dirname(fileURLToPath(import.meta.url))); const runtime = join(project, '.developer-preview');
const env = environment(runtime, '/opt/homebrew/opt/postgresql@17/bin');
privateDirectory(runtime); ownedFile(join(runtime, 'network.sb')); assert.equal(readFileSync(join(runtime, 'network.sb'), 'utf8'), sandbox);
if (!process.argv.includes('--sandboxed')) {
  await command({ project, runtime, env }, 'signature-integration', [process.execPath, fileURLToPath(import.meta.url), '--sandboxed', ...(process.argv.includes('--verify') ? ['--verify'] : [])], { timeout: 90000 });
  console.log('Synthetic signature integration PASS (private evidence retained).'); process.exit(0);
}
await new Promise((resolve, reject) => {
  const s = net.connect(443, '192.0.2.1'); const timer = setTimeout(() => { s.destroy(); reject(Error('Isolation probe timeout')); }, 2000);
  s.on('connect', () => { s.destroy(); clearTimeout(timer); reject(Error('Remote network not blocked')); });
  s.on('error', e => { clearTimeout(timer); ['EPERM', 'EACCES'].includes(e.code) ? resolve() : reject(Error('Isolation not proven')); });
});
for (const file of ['owner.json', 'ready.json', 'credentials.json']) ownedFile(join(runtime, file));
const owner = readJSON(join(runtime, 'owner.json')); const ready = readJSON(join(runtime, 'ready.json')); assert.equal(owner.uid, process.getuid()); assert.equal(owner.project, project); assert.equal(ready.owner, owner.id);
assert.equal(new URL(ready.url).hostname, '127.0.0.1'); assert.equal(new URL(ready.url).protocol, 'https:');
const require = createRequire(join(runtime, 'snapshot/package.json')); const { request } = require('@playwright/test'); const { PDFDocument } = require('pdf-lib');
const credentials = readJSON(join(runtime, 'credentials.json')); const contexts = [];
async function login(account) {
  const ctx = await request.newContext({ baseURL: ready.url, ignoreHTTPSErrors: true, extraHTTPHeaders: { origin: ready.url }, maxRedirects: 0 }); contexts.push(ctx);
  const res = await ctx.post('/api/auth/login', { data: { studentId: account.login, password: account.password } }); assert.equal(res.status(), 200, 'Normal synthetic login'); return ctx;
}
async function json(ctx, path, data) { const res = data ? await ctx.post(path, { data }) : await ctx.get(path); assert.equal(res.status(), 200, path); return res.json(); }
const evidencePath = join(runtime, 'signature-evidence.json');
try {
  const second = await login(credentials.accounts[1]); const other = await login(credentials.accounts[0]);
  let evidence;
  if (process.argv.includes('--verify')) { ownedFile(evidencePath); evidence = readJSON(evidencePath); assert.equal(evidence.owner, owner.id); }
  else {
    const formId = 'rights-responsibilities';
    assert.ok(!(await json(second, '/api/forms/status')).submissions.some(s => s.formId === formId), 'Refuse to overwrite an existing signature/form');
    // Generated opaque PNG: explicitly synthetic, not handwriting from the UI.
    const png = await require('sharp')({ create: { width: 64, height: 24, channels: 4, background: '#123456' } }).png().toBuffer();
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); page.drawText('SYNTHETIC PREVIEW STORAGE TEST - NOT PARTICIPANT EVIDENCE');
    page.drawImage(await pdf.embedPng(png), { x: 30, y: 30, width: 20, height: 20 }); const bytes = Buffer.from(await pdf.save());
    const uploaded = await second.post('/api/files', { multipart: { category: 'synthetic-signature-test', file: { name: 'synthetic-signed-test.pdf', mimeType: 'application/pdf', buffer: bytes } } });
    assert.equal(uploaded.status(), 200, 'PDF upload'); const file = (await uploaded.json()).file;
    const signed = await json(second, '/api/forms/sign', { formId, signature: `data:image/png;base64,${png.toString('base64')}`, fileId: file.id });
    evidence = { owner: owner.id, formId, fileId: file.id, signatureFileId: signed.signatureFileId, submissionId: signed.submission.id, pdfBase64: bytes.toString('base64'), studentId: file.studentId };
    saveJSON(evidencePath, evidence);
  }
  const status = (await json(second, '/api/forms/status')).submissions.find(s => s.formId === evidence.formId); assert.equal(status.id, evidence.submissionId); assert.equal(status.fileId, evidence.fileId);
  for (const id of [evidence.fileId, evidence.signatureFileId]) {
    const res = await second.get(`/api/files/download?id=${id}`); assert.equal(res.status(), 200);
    if (id === evidence.fileId) assert.deepEqual(await res.body(), Buffer.from(evidence.pdfBase64, 'base64'));
    assert.equal((await other.get(`/api/files/download?id=${id}`)).status(), 404);
  }
  assert.equal((await other.post('/api/forms/sign', { data: { formId: evidence.formId, studentId: evidence.studentId, signature: 'data:image/png;base64,AA==' } })).status(), 403);
  const anon = await request.newContext({ baseURL: ready.url, ignoreHTTPSErrors: true, maxRedirects: 0 }); contexts.push(anon);
  assert.equal((await anon.get(`/api/files/download?id=${evidence.fileId}`)).status(), 401);
  assert.equal((await other.post('/api/forms/sign', { data: { formId: evidence.formId, fileId: evidence.fileId, signature: 'data:image/png;base64,AA==' } })).status(), 403);
  if (!evidence.completionSubmitted) {
    const before = await json(second, '/api/orientation');
    const item = before.items.find(i => i.label === 'Review Rights and Responsibilities');
    assert.ok(item && !item.completed, 'Fresh unsatisfied orientation item');
    await json(second, '/api/orientation', { itemId: item.id, completed: true });
    evidence.itemId = item.id; evidence.completionSubmitted = true;
  }
  const orientation = await json(second, '/api/orientation');
  assert.equal(orientation.items.find(i => i.id === evidence.itemId)?.completed, true, 'Completion survives reread');
  evidence.orientationResponse = orientation; evidence.verifiedURL = ready.url; evidence.verifiedAt = new Date().toISOString(); evidence.restartVerified = process.argv.includes('--verify');
  saveJSON(evidencePath, evidence);
} finally { for (const ctx of contexts) await ctx.dispose(); }
