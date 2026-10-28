// Minimal private preview S3 subset. Never installed as an application backend.
import http from 'node:http';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory, ownedFile } from './developer-preview-support.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
export function createPreviewStorage({ runtime, accessKey, secretKey, bucket = 'synthetic-preview' }) {
  privateDirectory(runtime);
  if (realpathSync(runtime) !== runtime || bucket !== 'synthetic-preview' || !accessKey || !secretKey) throw new Error('Invalid private storage configuration');
  const root = join(runtime, 'objects'); privateDirectory(root);
  const fail = (res, status, code) => { res.writeHead(status, { 'content-type': 'application/xml', connection: 'close' }); res.end(`<Error><Code>${code}</Code></Error>`); };
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    try {
      privateDirectory(root);
      if (!['PUT', 'GET', 'HEAD', 'DELETE'].includes(req.method)) return fail(res, 405, 'MethodNotAllowed');
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) return fail(res, 403, 'AccessDenied');
      const [rawPath, query = ''] = req.url.split('?');
      if (!rawPath.startsWith('/') || req.url.length > 4096) return fail(res, 400, 'InvalidURI');
      const parts = rawPath.slice(1).split('/').map(decodeURIComponent);
      if (parts.shift() !== bucket) return fail(res, 403, 'AccessDenied');
      if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || /[\\/\x00-\x1f\x7f]/.test(p))) return fail(res, 400, 'InvalidURI');
      // No filesystem path comes from the request: only a SHA-256 digest.
      const path = join(root, sha(parts.join('/')));
      const params = new URLSearchParams(query);
      if ([...params].some(([k, v]) => k !== 'x-id' || !['PutObject', 'GetObject', 'HeadObject', 'DeleteObject'].includes(v))) return fail(res, 400, 'InvalidArgument');
      const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/us-east-1\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([a-f0-9]{64})$/.exec(req.headers.authorization || '');
      if (!auth || auth[1] !== accessKey) return fail(res, 403, 'AccessDenied');
      const date = req.headers['x-amz-date'] || '';
      if (!/^\d{8}T\d{6}Z$/.test(date) || date.slice(0, 8) !== auth[2]) return fail(res, 403, 'AccessDenied');
      const timestamp = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 300000) return fail(res, 403, 'RequestTimeTooSkewed');
      const names = auth[3].split(';');
      if (names.join(';') !== [...new Set(names)].sort().join(';') || !['host', 'x-amz-date', 'x-amz-content-sha256'].every(n => names.includes(n)) || names.some(n => typeof req.headers[n] !== 'string')) return fail(res, 403, 'AccessDenied');
      const payloadHash = req.headers['x-amz-content-sha256'];
      // Preview sets AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED; streams /
      // aws-chunked are explicitly unsupported, not silently stored as PDF bytes.
      if (!/^[a-f0-9]{64}$/.test(payloadHash) || req.headers['content-encoding'] || req.headers['x-amz-trailer'] || Object.keys(req.headers).some(k => k.startsWith('x-amz-checksum-'))) return fail(res, 400, 'InvalidRequest');
      const canonicalQuery = [...params].map(([k, v]) => [encode(k), encode(v)]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])).map(p => p.join('=')).join('&');
      const canonical = [req.method, '/' + [bucket, ...parts].map(encode).join('/'), canonicalQuery, names.map(n => `${n}:${req.headers[n].trim().replace(/\s+/g, ' ')}\n`).join(''), auth[3], payloadHash].join('\n');
      const scope = `${auth[2]}/us-east-1/s3/aws4_request`;
      const key = hmac(hmac(hmac(hmac('AWS4' + secretKey, auth[2]), 'us-east-1'), 's3'), 'aws4_request');
      const signature = hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`);
      if (!timingSafeEqual(signature, Buffer.from(auth[4], 'hex'))) return fail(res, 403, 'SignatureDoesNotMatch');
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_OBJECT_BYTES)) return fail(res, 413, 'EntityTooLarge');
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_OBJECT_BYTES) { fail(res, 413, 'EntityTooLarge'); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (sha(body) !== payloadHash) return fail(res, 400, 'XAmzContentSHA256Mismatch');
      if (req.method !== 'PUT' && size) return fail(res, 400, 'InvalidRequest');
      if (lstatSync(path, { throwIfNoEntry: false })) ownedFile(path);
      if (req.method === 'PUT') {
        const type = req.headers['content-type'] || 'application/octet-stream';
        if (!['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'application/octet-stream'].includes(type)) return fail(res, 400, 'InvalidArgument');
        // One atomic envelope persists metadata and bytes together. O_NOFOLLOW
        // and private flat directories reject symlinks; no untrusted subdirs.
        const temp = join(root, randomUUID());
        const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, Buffer.concat([Buffer.from(type + '\n'), body])); } finally { closeSync(fd); }
        renameSync(temp, path);
        res.writeHead(200, { ETag: `"${sha(body)}"` }); res.end(); return;
      }
      if (req.method === 'DELETE') { if (existsSync(path)) unlinkSync(path); res.writeHead(204); res.end(); return; }
      if (!existsSync(path)) return fail(res, 404, 'NoSuchKey');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let stored; try { stored = readFileSync(fd); } finally { closeSync(fd); }
      const split = stored.indexOf(10); const data = stored.subarray(split + 1);
      res.writeHead(200, { 'content-type': stored.subarray(0, split).toString(), 'content-length': data.length, ETag: `"${sha(data)}"`, 'cache-control': 'private, no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { if (!res.headersSent) fail(res, 400, 'InvalidRequest'); else res.destroy(); }
  });
  server.maxConnections = 32;
  server.timeout = 15000;
  return server;
}
