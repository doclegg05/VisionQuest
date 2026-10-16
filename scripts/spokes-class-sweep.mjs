// scripts/spokes-class-sweep.mjs
// node scripts/spokes-class-sweep.mjs --paths=<glob>[,<glob>...] [--rules=<rule>,...] [--write]
// Dry run by default: prints every change and every item that needs a hand fix.
// Exits 2 on bad input or when no files match, so a typo never looks like a clean sweep.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { ALL_RULES } from "./lib/spokes-class-map.mjs";
import { rewriteSource } from "./lib/spokes-source-rewrite.mjs";

const USAGE = "usage: node scripts/spokes-class-sweep.mjs --paths=<glob>[,<glob>...] [--rules=<rule>,...] [--write]";
const KNOWN_FLAG = /^--(?:paths=|rules=|write$)/;

function fail(message) {
  console.error(message);
  process.exit(2);
}

// Tests, declaration files, and installed packages are never swept.
function isSweepable(file) {
  return /\.tsx?$/.test(file)
    && !/\.(test|spec)\.tsx?$/.test(file)
    && !/\.d\.ts$/.test(file)
    && !/(^|[\\/])node_modules[\\/]/.test(file);
}

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const stray = args.filter((a) => a.startsWith("--") && !KNOWN_FLAG.test(a));
if (stray.length > 0) fail(`unknown argument(s): ${stray.join(", ")}\n${USAGE}`);
const paths = option("paths");
if (!paths) fail(USAGE);
const rules = option("rules")?.split(",") ?? ALL_RULES;
const unknown = rules.filter((rule) => !ALL_RULES.includes(rule));
if (unknown.length > 0) fail(`unknown rule(s): ${unknown.join(", ")}; known: ${ALL_RULES.join(", ")}`);
const write = args.includes("--write");
const files = [...new Set(paths.split(",").flatMap((glob) => globSync(glob)))]
  .filter(isSweepable)
  .sort();
if (files.length === 0) fail(`no files matched --paths=${paths}`);

let rewritten = 0;
let reviewCount = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const result = rewriteSource(source, file, rules);
  for (const c of result.changes) console.log(`${file}:${c.line}  ${c.from} -> ${c.to ?? "(removed)"}`);
  for (const r of result.review) console.log(`REVIEW ${file}:${r.line}  ${r.token}  (${r.reason})`);
  reviewCount += result.review.length;
  if (result.output === source) continue;
  rewritten += 1;
  if (write) writeFileSync(file, result.output);
}
console.log(`${write ? "rewrote" : "would rewrite"} ${rewritten} of ${files.length} file(s); ${reviewCount} item(s) need a hand fix`);
