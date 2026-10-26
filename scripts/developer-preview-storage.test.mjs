import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createPreviewStorage, MAX_OBJECT_BYTES } from './developer-preview-storage.mjs';
const require = createRequire(new URL('../.developer-preview/snapshot/package.json', import.meta.url));
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { SignatureV4 } = require('@smithy/signature-v4');
const { Hash } = require('@smithy/hash-node');
const { HttpRequest } = require('@smithy/protocol-http');
test('private persistent preview storage: actual SDK and hostile requests', async () => {
  const runtime = mkdtempSync(new URL('../.developer-preview/storage-test-', import.meta.url).pathname); chmodSync(runtime, 0o700);
  const config = { runtime, accessKey: 'synthetic-preview', secretKey: randomBytes(32).toString('hex') };
  let server; let client;
  async function start() {
    server = createPreviewStorage(config); await new Promise(r => server.listen(0, '127.0.0.1', r));
    client = new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${server.address().port}`, forcePathStyle: true, credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 1 });
  }
  async function stop() { client.destroy(); await new Promise(r => server.close(r)); }
  const object = { Bucket: 'synthetic-preview', Key: 'synthetic/signed test.pdf' }; const body = Buffer.from('%PDF-1.7\nsynthetic storage test');
  const status = (code) => error => error.$metadata?.httpStatusCode === code;
  try {
    await start();
    await client.send(new PutObjectCommand({ ...object, Body: body, ContentType: 'application/pdf' }));
    assert.equal((await client.send(new HeadObjectCommand(object))).ContentLength, body.length);
    await stop(); await start();
    const get = await client.send(new GetObjectCommand(object)); assert.deepEqual(Buffer.from(await get.Body.transformToByteArray()), body); assert.equal(get.ContentType, 'application/pdf');
    await assert.rejects(client.send(new PutObjectCommand({ ...object, Bucket: 'foreign', Body: body })), status(403));
    await assert.rejects(client.send(new PutObjectCommand({ ...object, Body: Buffer.alloc(MAX_OBJECT_BYTES + 1) })), status(413));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${endpoint}/synthetic-preview/synthetic/signed%20test.pdf`)).status, 403);
    assert.equal((await fetch(`${endpoint}/synthetic-preview/%ZZ`)).status, 400);
    assert.equal((await fetch(`${endpoint}/synthetic-preview/a%2F..%2Fx`)).status, 400);
    await assert.rejects(client.send(new PutObjectCommand({ ...object, ContentEncoding: 'aws-chunked', Body: body })), status(400));
    await assert.rejects(client.send(new PutObjectCommand({ ...object, ChecksumSHA256: 'bogus', Body: body })), status(400));
    // Independent signer lets us send a valid old signature or change bytes
    // AFTER signing, instead of testing only optional-checksum rejection.
    async function signedPut({ secret = config.secretKey, signingDate = new Date(), wireBody = body } = {}) {
      const signer = new SignatureV4({ service: 's3', region: 'us-east-1', credentials: { accessKeyId: config.accessKey, secretAccessKey: secret }, sha256: Hash.bind(null, 'sha256'), uriEscapePath: false });
      const url = new URL(endpoint);
      const req = await signer.sign(new HttpRequest({ protocol: 'http:', hostname: url.hostname, port: Number(url.port), method: 'PUT', path: '/synthetic-preview/synthetic/signed%20test.pdf', headers: { host: url.host, 'content-type': 'application/pdf' }, body }), { signingDate });
      return fetch(endpoint + req.path, { method: req.method, headers: req.headers, body: wireBody });
    }
    assert.equal((await signedPut()).status, 200, 'Independent SigV4 control request succeeds');
    const wrong = await signedPut({ secret: 'wrong-secret' }); assert.equal(wrong.status, 403); assert.match(await wrong.text(), /SignatureDoesNotMatch/);
    const stale = await signedPut({ signingDate: new Date(Date.now() - 600_000) }); assert.equal(stale.status, 403); assert.match(await stale.text(), /RequestTimeTooSkewed/);
    const altered = await signedPut({ wireBody: Buffer.from('tampered after signing') }); assert.equal(altered.status, 400); assert.match(await altered.text(), /XAmzContentSHA256Mismatch/);
    // Real filesystem failure, restricted to this test-owned directory; do not
    // add a fault-injection switch to the running storage service.
    assert.notEqual(process.getuid(), 0, 'Permission-failure regression must not run as root');
    chmodSync(join(runtime, 'objects'), 0o500);
    try { await assert.rejects(client.send(new PutObjectCommand({ ...object, Body: Buffer.from('replacement must fail'), ContentType: 'image/png' })), status(400)); }
    finally { chmodSync(join(runtime, 'objects'), 0o700); }
    const retained = await client.send(new GetObjectCommand(object));
    assert.equal(retained.ContentType, 'application/pdf'); assert.deepEqual(Buffer.from(await retained.Body.transformToByteArray()), body, 'Failed overwrite preserves prior object bytes and metadata');
    await client.send(new DeleteObjectCommand(object)); await assert.rejects(client.send(new GetObjectCommand(object)), status(404));
    const digest = createHash('sha256').update(object.Key).digest('hex'); symlinkSync(join(runtime, 'outside'), join(runtime, 'objects', digest));
    // Even dangling symlinks are rejected for reads and writes.
    await assert.rejects(client.send(new GetObjectCommand(object)), status(400));
    await assert.rejects(client.send(new PutObjectCommand({ ...object, Body: body })), status(400));
    const bad = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId: config.accessKey, secretAccessKey: 'incorrect' }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 1 });
    await assert.rejects(bad.send(new GetObjectCommand(object)), status(403)); bad.destroy();
  } finally { if (server?.listening) await stop(); rmSync(runtime, { recursive: true, force: true }); }
});
