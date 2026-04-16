#!/usr/bin/env node
// Codemod: replace hardcoded light-mode navy RGBA values with theme-aware CSS variables.
// Targets `rgba(18,38,63,*)` and `rgba(16,37,62,*)` — these are light-mode primary ink
// values that become invisible on dark backgrounds. Theme vars auto-swap per mode.
//
// Safe-by-default:
// - Only touches .tsx/.ts/.jsx/.js files under src/
// - Ignores `rgba(7,23,43,*)` (always-dark hero/overlay surfaces)
// - Pass --dry to preview without writing

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "src");
const DRY = process.argv.includes("--dry");

// Replacement rules — ordered, specific → generic.
// Each rule: [regex, replacement, label]
// Opacity fragment shared across rules (Tailwind accepts `0.1` and `0.10` interchangeably).
const OP = "0\\.(?:02|03|04|05|06|07|08|09|1|10|12|14|15|16|18|2|20|25|3|30|45)";
const RULES = [
  // --- Shadow tokens (must run before generic rgba rules) -------------------
  [
    /shadow-\[0_12px_28px_rgba\(16,\s*37,\s*62,\s*0\.12\)\]/g,
    "shadow-[var(--shadow-card)]",
    "shadow-card",
  ],
  [
    /shadow-\[0_(?:14|16|18)px_(?:28|34|36|40|50)px_rgba\(16,\s*37,\s*62,\s*0\.(?:08|1|10|12)\)\]/g,
    "shadow-[var(--shadow-card)]",
    "shadow-card-variants",
  ],
  [
    /shadow-\[0_20px_60px_rgba\(16,\s*37,\s*62,\s*0\.18\)\]/g,
    "shadow-[var(--shadow-card-lg)]",
    "shadow-card-lg-deep",
  ],
  [
    /shadow-\[0_16px_36px_rgba\(16,\s*37,\s*62,\s*0\.08\)\]/g,
    "shadow-[var(--shadow-card-lg)]",
    "shadow-card-lg",
  ],

  // --- Critical: white-on-white button in dark mode -------------------------
  // `bg-[var(--ink-strong)] text-white` → invisible in dark mode (ink-strong is white).
  // Replace with theme-aware accent primary.
  [
    /bg-\[var\(--ink-strong\)\] text-white hover:bg-\[rgba\(16,\s*37,\s*62,\s*0\.9\)\]/g,
    "bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-green)]/90",
    "btn-ink-primary",
  ],
  // Some use a comma after hover class (transition-colors sits between)
  [
    /bg-\[var\(--ink-strong\)\] ([^"'`]*?)hover:bg-\[rgba\(16,\s*37,\s*62,\s*0\.9\)\]/g,
    "bg-[var(--accent-strong)] $1hover:bg-[var(--accent-green)]/90",
    "btn-ink-primary-chained",
  ],

  // --- Border colors --------------------------------------------------------
  [
    new RegExp(`border-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "border-[var(--border)]",
    "border-navy",
  ],
  [
    new RegExp(`border-\\[rgba\\(16,\\s*37,\\s*62,\\s*${OP}\\)\\]`, "g"),
    "border-[var(--border)]",
    "border-navy-16",
  ],
  [
    new RegExp(`border-([tblr])-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "border-$1-[var(--border)]",
    "border-side-navy",
  ],
  [
    new RegExp(`border-([tblr])-\\[rgba\\(16,\\s*37,\\s*62,\\s*${OP}\\)\\]`, "g"),
    "border-$1-[var(--border)]",
    "border-side-navy-16",
  ],
  // Hover border variant
  [
    new RegExp(`hover:border-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "hover:border-[var(--border-strong)]",
    "hover-border",
  ],
  // Divide (table row separators)
  [
    new RegExp(`divide-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "divide-[var(--border)]",
    "divide-navy",
  ],

  // --- Backgrounds ----------------------------------------------------------
  // Divider bars (typically 0.12) → use border token
  [
    /bg-\[rgba\(18,\s*38,\s*63,\s*0\.12\)\]/g,
    "bg-[var(--border)]",
    "bg-divider",
  ],
  // Muted surfaces on both navy tones
  [
    new RegExp(`bg-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "bg-[var(--surface-muted)]",
    "bg-surface-muted",
  ],
  [
    new RegExp(`bg-\\[rgba\\(16,\\s*37,\\s*62,\\s*${OP}\\)\\]`, "g"),
    "bg-[var(--surface-muted)]",
    "bg-surface-muted-16",
  ],

  // --- Hover background variants -------------------------------------------
  [
    new RegExp(`hover:bg-\\[rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)\\]`, "g"),
    "hover:bg-[var(--surface-interactive-hover)]",
    "hover-surface",
  ],
  [
    new RegExp(`hover:bg-\\[rgba\\(16,\\s*37,\\s*62,\\s*${OP}\\)\\]`, "g"),
    "hover:bg-[var(--surface-interactive-hover)]",
    "hover-surface-16",
  ],

  // --- SVG presentation attributes -----------------------------------------
  // Modern browsers resolve var() inside stroke/fill presentation attrs.
  [
    new RegExp(`stroke="rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)"`, "g"),
    'stroke="var(--border)"',
    "svg-stroke",
  ],
  [
    new RegExp(`fill="rgba\\(18,\\s*38,\\s*63,\\s*${OP}\\)"`, "g"),
    'fill="var(--ink-faint)"',
    "svg-fill",
  ],
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, acc);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(ROOT);
let totalHits = 0;
const changedFiles = [];
const perRule = new Map();

for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  let next = original;
  let fileHits = 0;

  for (const [re, repl, label] of RULES) {
    const before = next;
    next = next.replace(re, repl);
    if (next !== before) {
      const hits = (before.match(re) || []).length;
      fileHits += hits;
      perRule.set(label, (perRule.get(label) || 0) + hits);
    }
  }

  if (fileHits > 0) {
    totalHits += fileHits;
    changedFiles.push({ file: path.relative(ROOT, file), hits: fileHits });
    if (!DRY) fs.writeFileSync(file, next, "utf8");
  }
}

console.log(`${DRY ? "[DRY RUN] " : ""}Scanned ${files.length} files.`);
console.log(`Total replacements: ${totalHits}`);
console.log(`Files changed: ${changedFiles.length}`);
console.log("\nPer-rule counts:");
for (const [label, count] of [...perRule.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(22)} ${count}`);
}
if (DRY) {
  console.log("\nTop 15 files by hits:");
  for (const row of changedFiles.sort((a, b) => b.hits - a.hits).slice(0, 15)) {
    console.log(`  ${String(row.hits).padStart(3)}  ${row.file}`);
  }
  console.log("\nRun without --dry to apply.");
}
