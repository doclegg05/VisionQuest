// Tests for the page weight script, against a local HTTP server that serves
// one page and three assets: one gzip, one brotli, one with no encoding.
//
// The script runs through execFile (async), not spawnSync: the fixture server
// lives in this process and could not answer while spawnSync blocked it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "page-weight.mjs");
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

const A_JS = Buffer.from("console.log('chunk a');\n".repeat(400));
const B_JS = Buffer.from("export const b = 'chunk b';\n".repeat(300));
const APP_CSS = Buffer.from(".card { color: #123456; }\n".repeat(50));
const A_GZIP = gzipSync(A_JS);
const B_BROTLI = brotliCompressSync(B_JS);

const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next">
<link rel="preload" href="/_next/static/media/font.woff2" as="font">
<link rel="icon" href="/_next/static/favicon.ico">
<script src="/_next/static/chunks/a.js" async></script>
<script src="/_next/static/chunks/a.js"></script>
<script src="/_next/static/chunks/b.js?v=1&amp;dpl=2" defer></script>
<script src="/vendor/analytics.js"></script>
<script>self.__next_f = [];</script>
</head><body></body></html>`;

const ROUTES = {
  "/": { body: Buffer.from(PAGE), type: "text/html" },
  "/_next/static/chunks/a.js": { body: A_GZIP, type: "text/javascript", encoding: "gzip" },
  "/_next/static/chunks/b.js?v=1&dpl=2": { body: B_BROTLI, type: "text/javascript", encoding: "br" },
  "/_next/static/css/app.css": { body: APP_CSS, type: "text/css" },
  "/waking-up": { body: Buffer.from("<html><body>Service starting</body></html>"), type: "text/html" },
  "/missing-asset": {
    body: Buffer.from(`<script src="/_next/static/chunks/gone.js"></script>`),
    type: "text/html",
  },
};

/** Start the fixture server. Resolves to its origin and the requests it saw. */
function startServer(t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, acceptEncoding: req.headers["accept-encoding"] });
    if (req.url === "/moved") return res.writeHead(302, { location: "/" }).end();
    const route = ROUTES[req.url];
    if (!route) return res.writeHead(404).end("not found");
    const headers = { "content-type": route.type };
    if (route.encoding) headers["content-encoding"] = route.encoding;
    res.writeHead(200, headers).end(route.body);
  });
  t.after(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, seen }));
  });
}

/** Run the script. Resolves to its exit code and output; never rejects. */
function pageWeight(...args) {
  const env = { ...process.env };
  for (const name of PROXY_VARS) delete env[name];
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

async function measured(t, path = "/") {
  const { origin, seen } = await startServer(t);
  const result = await pageWeight(`${origin}${path}`, "--json");
  assert.equal(result.code, 0, result.stderr);
  return { origin, seen, report: JSON.parse(result.stdout) };
}

test("collects each script src and stylesheet href under /_next/static/ once", async (t) => {
  const { origin, report } = await measured(t);
  assert.deepEqual(report.assets.map((asset) => asset.url).sort(), [
    `${origin}/_next/static/chunks/a.js`,
    `${origin}/_next/static/chunks/b.js?v=1&dpl=2`,
    `${origin}/_next/static/css/app.css`,
  ]);
});

test("counts compressed bytes as sent and uncompressed bytes after decoding", async (t) => {
  const { report } = await measured(t);
  const sizes = Object.fromEntries(
    report.assets.map((asset) => [new URL(asset.url).pathname, [asset.compressedBytes, asset.uncompressedBytes]])
  );
  assert.deepEqual(sizes, {
    "/_next/static/chunks/a.js": [A_GZIP.length, A_JS.length],
    "/_next/static/chunks/b.js": [B_BROTLI.length, B_JS.length],
    "/_next/static/css/app.css": [APP_CSS.length, APP_CSS.length],
  });
});

test("reports totals and how many scripts and stylesheets it found", async (t) => {
  const { report } = await measured(t);
  assert.deepEqual(report.totals, {
    scripts: 2,
    stylesheets: 1,
    compressedBytes: A_GZIP.length + B_BROTLI.length + APP_CSS.length,
    uncompressedBytes: A_JS.length + B_JS.length + APP_CSS.length,
  });
});

test("asks every asset for gzip and br", async (t) => {
  const { seen } = await measured(t);
  const assets = seen.filter((request) => request.url.startsWith("/_next/static/"));
  assert.equal(assets.length, 3);
  for (const request of assets) assert.equal(request.acceptEncoding, "gzip, br");
});

test("prints a table, then the compressed total in KB as a bare number on the last line", async (t) => {
  const { origin } = await startServer(t);
  const result = await pageWeight(`${origin}/`);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  const totalBytes = A_GZIP.length + B_BROTLI.length + APP_CSS.length;
  assert.equal(lines.at(-1), (totalBytes / 1000).toFixed(1));
  assert.ok(lines.some((line) => line.includes("/_next/static/chunks/a.js")), "the table lists each asset");
});

test("follows a redirect to the page", async (t) => {
  const { report } = await measured(t, "/moved");
  assert.equal(report.assets.length, 3);
});

test("an asset that does not answer 200 is an error, not a smaller total", async (t) => {
  const { origin } = await startServer(t);
  const result = await pageWeight(`${origin}/missing-asset`);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /HTTP 404/);
});

test("a page with no /_next/static/ assets is an error, not a zero weight", async (t) => {
  const { origin } = await startServer(t);
  const result = await pageWeight(`${origin}/waking-up`);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no \/_next\/static\/ assets/);
});

test("a refused connection exits 1 and names the error code", async () => {
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const result = await pageWeight(`http://127.0.0.1:${port}/`);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ECONNREFUSED/);
});

test("no URL is a usage error", async () => {
  const result = await pageWeight();
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Usage/);
});
