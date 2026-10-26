// Private preview supervisor. No inherited secrets, no remote network access.
import http from 'node:http';
import { createPreviewStorage } from './developer-preview-storage.mjs';
import https from 'node:https';
import { readFileSync, openSync, closeSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { availablePort, readJSON, saveJSON, privateDirectory, ownedFile, processIdentity } from './developer-preview-support.mjs';

process.umask(0o077);
const [runtime, owner] = process.argv.slice(2);
privateDirectory(runtime); ownedFile(join(runtime, 'owner.json'));
const marker = readJSON(join(runtime, 'owner.json'));
if (marker.id !== owner || marker.uid !== process.getuid()) throw new Error('Worker ownership mismatch');
ownedFile(join(runtime, 'runtime-env.json'));
const env = readJSON(join(runtime, 'runtime-env.json'));
const sockets = new Set();
const servers = [];
let child; let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  if (existsSync(join(runtime, 'ready.json'))) rmSync(join(runtime, 'ready.json'));
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
    await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timer);
  }
  process.exit(code);
}
process.on('SIGTERM', () => shutdown()); process.on('SIGINT', () => shutdown());
function watch(server) {
  servers.push(server); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('error', () => shutdown(1));
}
async function main() {
  const storage = createPreviewStorage({ runtime, accessKey: env.STORAGE_ACCESS_KEY, secretKey: env.STORAGE_SECRET_KEY, bucket: env.STORAGE_BUCKET });
  watch(storage); await new Promise(resolve => storage.listen(0, '127.0.0.1', resolve));
  const appPort = await availablePort();
  const tls = https.createServer({ key: readFileSync(join(runtime, 'localhost.key')), cert: readFileSync(join(runtime, 'localhost.crt')) }, (req, res) => {
    const host = `127.0.0.1:${tls.address().port}`;
    if (req.headers.host !== host) { res.writeHead(400); res.end('Local preview host required'); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: { ...req.headers, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' } }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  watch(tls); await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${tls.address().port}`;
  const log = openSync(join(runtime, 'logs/standalone.log'), 'a', 0o600);
  child = spawn(process.execPath, ['.next/standalone/server.js'], { cwd: join(runtime, 'snapshot'), env: { ...env, AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED', AWS_RESPONSE_CHECKSUM_VALIDATION: 'WHEN_REQUIRED', PORT: String(appPort), APP_BASE_URL: url, STORAGE_ENDPOINT: `http://127.0.0.1:${storage.address().port}` }, stdio: ['ignore', log, log] });
  closeSync(log); child.on('error', () => shutdown(1)); child.on('exit', () => { if (!stopping) shutdown(1); });
  await new Promise(resolve => setTimeout(resolve, 150));
  saveJSON(join(runtime, 'children.json'), { owner, app: { pid: child.pid, identity: processIdentity(child.pid), launchPath: join(runtime, 'snapshot/.next/standalone/server.js') } });
  for (let i = 0; i < 100; i++) {
    if (stopping) return;
    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/api/dev-login`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 404) {
        // Next sets process.title during boot; bind identity after that change.
        saveJSON(join(runtime, 'children.json'), { owner, app: { pid: child.pid, identity: processIdentity(child.pid), launchPath: join(runtime, 'snapshot/.next/standalone/server.js') } });
        saveJSON(join(runtime, 'ready.json'), { owner, url, appPort, storagePort: storage.address().port, started: new Date().toISOString() });
        console.log('Standalone/TLS/private-object services ready on loopback; no remote services enabled.'); return;
      }
    } catch { /* bounded startup polling */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await shutdown(1);
}
main().catch(() => shutdown(1));
