#!/usr/bin/env node
/**
 * Page weight: the size of the scripts and styles one URL loads.
 *
 *   node scripts/readiness/page-weight.mjs <url> [--json]
 *
 * Fetches the HTML, collects every script `src` and stylesheet `href` under
 * `/_next/static/`, and requests each one once with `Accept-Encoding: gzip, br`.
 * Compressed bytes are the body bytes as sent. `node:http` and `node:https`
 * hand them over undecoded, which `fetch` does not. Uncompressed bytes are the
 * same body after decoding.
 *
 * Prints a table, then the compressed total in KB (1 KB = 1000 bytes) as a
 * bare number on the last line, so the M4 gate in the readiness scorecard can
 * read it. With --json it prints one JSON object and nothing else.
 *
 * Behind a proxy, run it with NODE_USE_ENV_PROXY=1 so Node uses HTTPS_PROXY.
 * The scorecard sets that for every gate marked `needs: "network"`.
 *
 * Exit codes: 0 measured; 1 a request failed (the message carries the error
 * code, such as ECONNREFUSED) or an asset did not answer 200; 2 usage.
 */

import { realpathSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const STATIC_PREFIX = "/_next/static/";
const ASSET_ENCODINGS = "gzip, br";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const BYTES_PER_KB = 1000;
const DECODERS = { br: brotliDecompressSync, gzip: gunzipSync, deflate: inflateSync };
const USAGE = "Usage: node scripts/readiness/page-weight.mjs <url> [--json]";

/** GET a URL, following redirects. Resolves to the undecoded body. */
function request(url, acceptEncoding, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const options = { headers: { "accept-encoding": acceptEncoding, "user-agent": "page-weight" }, timeout: TIMEOUT_MS };
    const req = client.get(url, options, (res) => {
      const { location } = res.headers;
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error(`too many redirects at ${url}`));
        return resolve(request(new URL(location, url), acceptEncoding, redirects + 1));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ url, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`ETIMEDOUT after ${TIMEOUT_MS} ms: ${url}`)));
    req.on("error", reject);
  });
}

/** Every script src and stylesheet href under /_next/static/, once each. */
export function findAssets(html, pageUrl) {
  const found = new Map();
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const isScript = /^<script/i.test(tag);
    if (!isScript && !/\brel=["']?stylesheet\b/i.test(tag)) continue;
    const reference = tag.match(isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i)?.[1];
    if (!reference) continue;
    const url = new URL(reference.replaceAll("&amp;", "&"), pageUrl);
    if (url.pathname.includes(STATIC_PREFIX)) found.set(url.href, isScript ? "script" : "stylesheet");
  }
  return [...found].map(([url, kind]) => ({ url, kind }));
}

async function measureAsset({ url, kind }) {
  const res = await request(new URL(url), ASSET_ENCODINGS);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  const encoding = res.headers["content-encoding"] ?? "identity";
  const decode = DECODERS[encoding];
  if (encoding !== "identity" && !decode) throw new Error(`cannot decode content-encoding ${encoding} for ${url}`);
  const uncompressedBytes = decode ? decode(res.body).length : res.body.length;
  return { url, kind, encoding, compressedBytes: res.body.length, uncompressedBytes };
}

export async function measurePage(pageUrl) {
  const page = await request(new URL(pageUrl), "identity");
  if (page.status !== 200) throw new Error(`HTTP ${page.status} for ${pageUrl}`);
  const found = findAssets(page.body.toString("utf8"), page.url);
  // A waking-up or error page has none. Zero would read as a perfect score.
  if (found.length === 0) throw new Error(`no /_next/static/ assets at ${page.url.href}, so there is nothing to weigh`);
  const assets = await Promise.all(found.map(measureAsset));
  const sum = (field) => assets.reduce((total, asset) => total + asset[field], 0);
  const count = (kind) => assets.filter((asset) => asset.kind === kind).length;
  const totals = {
    scripts: count("script"),
    stylesheets: count("stylesheet"),
    compressedBytes: sum("compressedBytes"),
    uncompressedBytes: sum("uncompressedBytes"),
  };
  return { url: page.url.href, assets, totals };
}

function formatTable({ url, assets, totals }) {
  const row = (compressed, uncompressed, encoding, name) =>
    `${String(compressed).padStart(10)}  ${String(uncompressed).padStart(12)}  ${encoding.padEnd(8)}  ${name}`;
  const path = (asset) => new URL(asset.url).pathname;
  return [
    `Page weight for ${url} (bytes; 1 KB = ${BYTES_PER_KB} bytes)`,
    "",
    row("Compressed", "Uncompressed", "Encoding", "Asset"),
    ...assets.map((asset) => row(asset.compressedBytes, asset.uncompressedBytes, asset.encoding, path(asset))),
    row(totals.compressedBytes, totals.uncompressedBytes, "", `total: ${totals.scripts} scripts, ${totals.stylesheets} stylesheets`),
    "",
    "Compressed total in KB:",
    (totals.compressedBytes / BYTES_PER_KB).toFixed(1),
  ].join("\n");
}

async function main(argv) {
  const json = argv.includes("--json");
  const [url, ...extra] = argv.filter((arg) => arg !== "--json");
  if (!url || extra.length > 0 || url.startsWith("--") || !URL.canParse(url)) {
    console.error(USAGE);
    return 2;
  }
  try {
    const report = await measurePage(url);
    console.log(json ? JSON.stringify(report, null, 2) : formatTable(report));
    return 0;
  } catch (error) {
    // AggregateError (a refused dual-stack connect) has an empty message, so
    // print the code as well: the scorecard reads it to tell "could not
    // connect" from a real failure.
    console.error(`page-weight: ${[error.code, error.message].filter(Boolean).join(" ")}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
