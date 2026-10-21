#!/usr/bin/env node
// Splits session-log sections out of a MEMORY.md-style file, one file each,
// and proves nothing was lost via findMissingLines.
import fs from "node:fs";
import path from "node:path";

const SESSION_HEADING =
  /^## (Last Session|Prior Session|Also |Previous Session|Session Before That)/;
const DATE = /\d{4}-\d{2}-\d{2}/;
const MAX_SLUG = 60;

function slugify(heading) {
  const words = heading
    .replace(DATE, " ")
    .replace(/\b(prior|also|session)\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return words.slice(0, MAX_SLUG).replace(/-+$/, "");
}

function findDate(heading, bodyLines) {
  const inHeading = heading.match(DATE);
  if (inHeading) return inHeading[0];
  const dateLine = bodyLines.find((l) => l.includes("**Date**:"));
  const inBody = dateLine ? dateLine.match(DATE) : null;
  return inBody ? inBody[0] : null;
}

function uniqueName(base, taken) {
  let name = `${base}.md`;
  for (let n = 2; taken.has(name); n += 1) name = `${base}-${n}.md`;
  taken.add(name);
  return name;
}

function groupSections(lines) {
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    if (line.startsWith("## ")) {
      sections.push(current);
      current = { heading: line, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

export function splitSessions(markdown) {
  const sections = groupSections(markdown.split("\n"));
  const keptLines = [];
  const handoffs = [];
  const taken = new Set();
  let undated = 0;

  for (const section of sections) {
    if (!section.heading || !SESSION_HEADING.test(section.heading)) {
      keptLines.push(...section.lines);
      continue;
    }
    const headingText = section.heading.slice(3);
    const body = section.lines.slice(1);
    const date = findDate(headingText, body);
    const slug = slugify(headingText) || "session";
    let base;
    if (date) {
      base = `${date}-${slug}`;
    } else {
      undated += 1;
      base = `undated-${undated}-${slug}`;
    }
    handoffs.push({
      filename: uniqueName(base, taken),
      content: [`# ${headingText}`, ...body].join("\n"),
    });
  }
  return { kept: keptLines.join("\n"), handoffs };
}

// Heading level is ignored: a split turns "## x" into "# x", same text.
function normalize(line) {
  return line.trim().replace(/^#+\s*/, "");
}

export function findMissingLines(original, outputs) {
  const seen = new Set();
  for (const out of outputs) {
    for (const line of out.split("\n")) seen.add(normalize(line));
  }
  return original
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !seen.has(normalize(line)));
}

function parseArgs(argv) {
  const args = { input: null, outDir: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out-dir") args.outDir = argv[(i += 1)];
    else if (argv[i] === "--write") args.write = true;
    else if (!args.input) args.input = argv[i];
  }
  return args;
}

function lineCount(text) {
  return text.split("\n").length;
}

function main() {
  const { input, outDir, write } = parseArgs(process.argv.slice(2));
  if (!input || !outDir) {
    console.error(
      "usage: split-sessions.mjs <in.md> --out-dir <dir> [--write]",
    );
    process.exit(2);
  }
  const original = fs.readFileSync(input, "utf8");
  const { kept, handoffs } = splitSessions(original);
  const missing = findMissingLines(original, [
    kept,
    ...handoffs.map((h) => h.content),
  ]);
  if (missing.length > 0) {
    console.error(`${missing.length} line(s) would be lost:`);
    for (const line of missing) console.error(line);
    process.exit(1);
  }
  for (const h of handoffs) {
    console.log(`${h.filename}  ${lineCount(h.content)}`);
  }
  console.log(`kept  ${lineCount(kept)}`);
  if (!write) return;
  fs.mkdirSync(outDir, { recursive: true });
  for (const h of handoffs) {
    fs.writeFileSync(path.join(outDir, h.filename), `${h.content}\n`);
  }
  fs.writeFileSync(input, kept);
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
