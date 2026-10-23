#!/usr/bin/env node
// Guards .claude/MEMORY.md so it stays a short, current handoff file.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_LINES = 300;
const MAX_STATUS_LINES = 20;
const MAX_LAST_SESSION_LINES = 4;
const REQUIRED_HEADINGS = [
  "## Project Overview",
  "## Current Status",
  "## Last Session",
  "## Open Items",
  "## History and Decisions",
  "## Architecture Notes",
  "## Known Issues",
];
const SESSION_HEADING =
  /^## (Prior Session|Also |Previous Session|Session Before That)/;

function sectionBody(lines, heading) {
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

function nonBlank(lines) {
  return lines.filter((l) => l.trim() !== "").length;
}

function checkHeadings(lines) {
  const errors = [];
  const positions = REQUIRED_HEADINGS.map((h) => lines.indexOf(h));
  REQUIRED_HEADINGS.forEach((h, i) => {
    if (positions[i] === -1) errors.push(`missing heading: ${h}`);
  });
  const found = positions.filter((p) => p !== -1);
  const sorted = [...found].sort((a, b) => a - b);
  if (found.some((p, i) => p !== sorted[i])) {
    errors.push(`headings are out of order, expected: ${REQUIRED_HEADINGS.join(", ")}`);
  }
  return errors;
}

export function checkMemoryFile(text) {
  const lines = text.split("\n");
  const errors = [];
  if (lines.length > MAX_LINES) {
    errors.push(`file has ${lines.length} lines, the limit is ${MAX_LINES}`);
  }
  errors.push(...checkHeadings(lines));
  for (const line of lines) {
    if (SESSION_HEADING.test(line)) {
      errors.push(`session heading belongs in .claude/handoffs/: ${line}`);
    }
  }
  const status = nonBlank(sectionBody(lines, "## Current Status"));
  if (status > MAX_STATUS_LINES) {
    errors.push(`Current Status has ${status} lines, the limit is ${MAX_STATUS_LINES}`);
  }
  const last = nonBlank(sectionBody(lines, "## Last Session"));
  if (last > MAX_LAST_SESSION_LINES) {
    errors.push(`Last Session has ${last} lines, the limit is ${MAX_LAST_SESSION_LINES}`);
  }
  lines.forEach((line, i) => {
    if (/^\s*- \[x\]/i.test(line) || line.includes("~~")) {
      errors.push(`closed item on line ${i + 1}, move it to docs/decisions/closed-items.md`);
    }
  });
  return errors;
}

function main() {
  const file = process.argv[2] || ".claude/MEMORY.md";
  const errors = checkMemoryFile(fs.readFileSync(file, "utf8"));
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log(`${file}: ok`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isMain) main();
