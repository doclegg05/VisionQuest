#!/usr/bin/env node
/**
 * UI-copy readability instrument.
 *
 * SPOKES serves TANF/SNAP adult learners at a 6th-grade reading-level target.
 * src/lib/sage/readability.ts already gates Sage's own chat replies
 * (scripts/sage-quality-eval.mjs); this script applies the SAME deterministic
 * Flesch-Kincaid scorer to student-facing UI copy, which today is unmeasured.
 *
 * It walks a fixed set of student-facing source roots, parses each file with
 * the TypeScript compiler API (the same `typescript` package already a repo
 * dependency — no AST library added), and pulls out string literals that sit
 * in a "copy position": JSX text nodes, JSX children written as
 * `{condition ? "a" : "b"}`, JSX attributes whose name reads like a copy prop
 * (title/description/label/aria-label/...), and object-property or
 * variable/const assignments with a copy-like name (title, description,
 * whyItMatters, ERROR_MESSAGES, ...). See `collectContext()` below for the
 * exact walk.
 *
 * This is a pragmatic, AST-assisted heuristic, not a full i18n string
 * extractor — known gaps are documented inline where the heuristic gives up
 * (search "LIMITATION" in this file).
 *
 * Usage:
 *   npx tsx scripts/ui-copy-readability.mjs             (report mode, always exits 0)
 *   npx tsx scripts/ui-copy-readability.mjs --gate       (exits 1 if any non-exempt
 *                                                          scorable string exceeds
 *                                                          the grade ceiling)
 *
 * The grade ceiling is read from src/lib/sage/readability.ts's exported
 * PLAIN_LANGUAGE_MAX_GRADE — the single knob shared with the Sage gate. The
 * ideal grade (PLAIN_LANGUAGE_IDEAL_GRADE, 6) is reported as a comparison
 * point for the median but is NOT itself gated.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const ALLOWLIST_PATH = join(REPO_ROOT, "config/ui-readability-allowlist.json");
const TRUNCATE_AT = 110;
const TOP_WORST_COUNT = 15;

// ---------------------------------------------------------------------------
// Scan roots
//
// The task brief asked for src/app/(student), src/app/(auth), and
// src/components/{progression,dashboard,orientation,goals,career,onboarding,chat}.
// This checkout's Next.js route groups are only (student)/(teacher)/(admin)/
// (coordinator) — there is no literal src/app/(auth) directory — and
// src/components/onboarding does not exist. Rather than silently scan
// nothing for "auth", this substitutes the real locations of student-visible
// auth screens: the root login/register page (src/app/page.tsx, which only
// renders <AuthPageClient/>) plus the password-recovery flow, and the shared
// src/components/auth client components that actually hold the copy
// (AuthPageClient.tsx). teacher-register/, credentials/[slug]/, and cdc/ are
// deliberately excluded — they are not the student login/registration
// surface. src/components/onboarding is skipped because it does not exist.
//
// One further, narrow extension: the "next step" card's copy
// (title/description/whyItMatters) is generated as plain data in
// src/lib/progression/student-next-step.ts and only ever interpolated
// (never re-declared as a literal) by
// src/components/progression/PathToEmployment.tsx. Scanning the component
// alone would find zero literal strings for that surface, so the one lib
// file that owns the copy is included explicitly. This is a single-file
// carve-out, not a general sweep of src/lib.
//
// components/student was added 2026-08-20 alongside the "What Sage
// Remembers About You" memory-inspector page (src/app/(student)/memory) —
// its copy lives partly in src/components/student/SageMemoryList.tsx and
// SageMemoryPanel.tsx, which sat outside every existing root and so were
// silently unscanned. AssignedFormsCard.tsx already lived in this directory
// with only short (<12-word, non-scorable) strings, so adding the root
// does not newly fail anything that already passed.
// ---------------------------------------------------------------------------
const SCAN_ROOTS = [
  { label: "student app routes", relPath: "src/app/(student)" },
  { label: "auth entry page (substitutes src/app/(auth))", relPath: "src/app/page.tsx" },
  { label: "forgot-password flow", relPath: "src/app/forgot-password" },
  { label: "reset-password flow", relPath: "src/app/reset-password" },
  { label: "recovery-setup flow", relPath: "src/app/recovery-setup" },
  { label: "shared auth components", relPath: "src/components/auth" },
  { label: "components/progression", relPath: "src/components/progression" },
  { label: "components/dashboard", relPath: "src/components/dashboard" },
  { label: "components/orientation", relPath: "src/components/orientation" },
  { label: "components/goals", relPath: "src/components/goals" },
  { label: "components/career", relPath: "src/components/career" },
  { label: "components/onboarding", relPath: "src/components/onboarding" },
  { label: "components/chat", relPath: "src/components/chat" },
  { label: "components/student", relPath: "src/components/student" },
  { label: "next-step copy data (src/lib carve-out)", relPath: "src/lib/progression/student-next-step.ts" },
  // Match & Connect Phase 4. Three surfaces that were outside every root:
  // the Settings consent toggles a student reads before turning employer
  // introductions on or off; the job-developer console, whose copy an
  // instructor reads but whose student-facing strings (status phrases, packet
  // field labels) come straight from the same helpers the student sees; and
  // the public employer response page, which is read by someone with no
  // account and no context at all.
  { label: "components/settings", relPath: "src/components/settings" },
  { label: "components/teacher/connect", relPath: "src/components/teacher/connect" },
  { label: "public employer response page", relPath: "src/app/connect" },
];

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------
function isTestFile(filePath) {
  return /\.(test|spec)\.(tsx?|jsx?)$/.test(filePath) || /(^|[\\/])__tests__([\\/]|$)/.test(filePath);
}

function isSourceFile(name) {
  return /\.(tsx?|jsx?)$/.test(name);
}

function walk(root, out) {
  const st = statSync(root);
  if (st.isFile()) {
    if (isSourceFile(root) && !isTestFile(root)) out.push(root);
    return;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSourceFile(entry.name) && !isTestFile(full)) out.push(full);
  }
}

// ---------------------------------------------------------------------------
// Copy-position detection
//
// A string literal counts as a candidate when it sits in one of these
// positions:
//   1. Plain JSX text between tags (handled separately, always a candidate).
//   2. A JSX child written as `{...}` — including through ternaries/`||`/`??`
//      chains — e.g. `{loading ? "Saving…" : "Save"}`.
//   3. A JSX attribute whose name reads like copy (title, label,
//      aria-label, ...) — className/href/id/aria-*(other than aria-label)/
//      data-*/event-handlers are hard-excluded regardless of any other
//      match.
//   4. An object property, `const`/`let` initializer, or a later
//      `name = "..."` reassignment, whose name reads like copy (title,
//      description, whyItMatters, ERROR_MESSAGES, HIGHLIGHTS, ...).
//
// LIMITATION: a string passed as a bare call-expression argument with no
// naming context (e.g. `showToast("Some long message")`) is NOT caught —
// there is nothing to key a "copy-like name" match against. This is the
// same reason console/log strings are naturally excluded, per the task
// scope, rather than a special case.
// ---------------------------------------------------------------------------
const COPY_TOKENS = new Set([
  "title", "description", "label", "subtitle", "subheading", "heading", "summary",
  "message", "messages", "headline", "tooltip", "instruction", "instructions",
  "caption", "hint", "intro", "introduction", "placeholder", "content", "copy",
  "note", "notes", "tagline", "blurb", "highlight", "highlights", "text", "body",
  "matters", "feature", "features", "benefit", "benefits", "tip", "tips", "prompt",
  "greeting", "welcome", "warning", "error", "errors", "success", "cta", "helper",
]);

const HARD_EXCLUDE_ATTRS = new Set([
  "classname", "class", "id", "href", "key", "ref", "style", "name", "value", "type",
  "role", "tabindex", "rel", "target", "src", "srcset", "colspan", "rowspan", "width",
  "height", "min", "max", "step", "pattern", "autocomplete", "method", "action",
  "enctype", "viewbox", "xmlns", "fill", "stroke", "d", "points", "cx", "cy", "r",
  "htmlfor", "for", "x", "y", "dx", "dy",
]);

function isHardExcludedAttr(attrName) {
  const lower = attrName.toLowerCase();
  if (HARD_EXCLUDE_ATTRS.has(lower)) return true;
  if (lower.startsWith("data-")) return true;
  if (lower.startsWith("aria-") && lower !== "aria-label") return true;
  if (lower.startsWith("on") && lower.length > 2) return true; // event handlers
  return false;
}

function tokensOf(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function nameLooksLikeCopy(name) {
  return tokensOf(name).some((t) => COPY_TOKENS.has(t));
}

/**
 * Walk up from a string-literal-like node to find its syntactic context.
 * Returns { jsxChild, names, hardExcluded }.
 */
function collectContext(node) {
  const names = [];
  let jsxChild = false;
  let cur = node.parent;
  let steps = 0;

  while (cur && steps < 80) {
    steps++;
    switch (cur.kind) {
      case ts.SyntaxKind.JsxAttribute: {
        const attrName = cur.name.getText();
        if (isHardExcludedAttr(attrName)) return { jsxChild: false, names: [], hardExcluded: true };
        if (attrName.toLowerCase() === "aria-label") return { jsxChild: true, names, hardExcluded: false };
        names.push(attrName);
        cur = cur.parent;
        continue;
      }
      case ts.SyntaxKind.JsxExpression: {
        const p = cur.parent;
        if (p && (p.kind === ts.SyntaxKind.JsxElement || p.kind === ts.SyntaxKind.JsxFragment)) {
          return { jsxChild: true, names, hardExcluded: false };
        }
        cur = cur.parent; // attribute initializer — keep walking to JsxAttribute
        continue;
      }
      case ts.SyntaxKind.PropertyAssignment: {
        const nameNode = cur.name;
        const propName =
          ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) ? nameNode.text : nameNode.getText();
        names.push(propName);
        cur = cur.parent;
        continue;
      }
      case ts.SyntaxKind.VariableDeclaration: {
        names.push(cur.name.getText());
        return { jsxChild, names, hardExcluded: false };
      }
      case ts.SyntaxKind.BinaryExpression: {
        if (cur.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(cur.left)) {
          names.push(cur.left.text);
          return { jsxChild, names, hardExcluded: false };
        }
        if (
          [
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(cur.operatorToken.kind)
        ) {
          cur = cur.parent;
          continue;
        }
        return { jsxChild, names, hardExcluded: false };
      }
      case ts.SyntaxKind.ArrayLiteralExpression:
      case ts.SyntaxKind.ObjectLiteralExpression:
      case ts.SyntaxKind.ParenthesizedExpression:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.TemplateSpan:
      case ts.SyntaxKind.ReturnStatement:
      case ts.SyntaxKind.SpreadElement:
        cur = cur.parent;
        continue;
      default:
        return { jsxChild, names, hardExcluded: false };
    }
  }
  return { jsxChild, names, hardExcluded: false };
}

function isCopyCandidate(node) {
  const ctx = collectContext(node);
  if (ctx.hardExcluded) return false;
  if (ctx.jsxChild) return true;
  return ctx.names.some((n) => nameLooksLikeCopy(n));
}

/**
 * Skip strings that tokenize into >=12 "words" only because of hyphens or
 * slashes (CSS class lists, paths, URLs) rather than real prose. Natural
 * sentences have real whitespace between most words; code-like strings
 * usually don't.
 */
function looksCodeLike(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!/\s/.test(trimmed)) return true; // single token, no whitespace at all
  const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
  if (spaceTokens.length < 6) return true; // too few real words to be prose
  if (/^(https?:|mailto:|tel:|\/|#)/.test(trimmed)) return true; // url/path/anchor
  return false;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return { exact: new Set(), paths: [] };
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const exemptions = Array.isArray(parsed.exemptions) ? parsed.exemptions : [];
  const exact = new Set();
  const paths = [];
  for (const entry of exemptions) {
    if (!entry || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(
        `config/ui-readability-allowlist.json: every entry needs a non-empty "reason" (bad entry: ${JSON.stringify(entry)})`,
      );
    }
    if (entry.type === "exact" && typeof entry.value === "string") {
      exact.add(entry.value);
    } else if (entry.type === "path" && typeof entry.value === "string") {
      paths.push(entry.value);
    } else {
      throw new Error(
        `config/ui-readability-allowlist.json: entry must be {type:"exact"|"path", value, reason} (bad entry: ${JSON.stringify(entry)})`,
      );
    }
  }
  return { exact, paths };
}

function isExempt(allowlist, text, relPath) {
  if (allowlist.exact.has(text)) return true;
  return allowlist.paths.some((p) => relPath === p || relPath.startsWith(p));
}

// ---------------------------------------------------------------------------
// Extraction + scoring
// ---------------------------------------------------------------------------
function truncate(text) {
  return text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}…` : text;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const gate = process.argv.includes("--gate");

  const { assessReadability, PLAIN_LANGUAGE_MAX_GRADE, PLAIN_LANGUAGE_IDEAL_GRADE } = await import(
    "../src/lib/sage/readability.ts"
  );
  const allowlist = loadAllowlist();

  const rootNotes = [];
  const files = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root.relPath);
    if (!existsSync(abs)) {
      rootNotes.push(`  [skip]  ${root.label} — ${root.relPath} (not present in this checkout)`);
      continue;
    }
    const before = files.length;
    walk(abs, files);
    rootNotes.push(`  [scan]  ${root.label} — ${root.relPath} (${files.length - before} files)`);
  }

  const candidates = [];
  for (const file of files) {
    const relPath = relative(REPO_ROOT, file);
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      console.warn(`  [warn]  could not read ${relPath}: ${err.message}`);
      continue;
    }

    let sourceFile;
    try {
      sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    } catch (err) {
      console.warn(`  [warn]  could not parse ${relPath}: ${err.message}`);
      continue;
    }

    const record = (node, rawText) => {
      const text = rawText.replace(/\s+/g, " ").trim();
      if (!text || looksCodeLike(text)) return;
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const assessment = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_MAX_GRADE });
      candidates.push({
        file: relPath,
        line: line + 1,
        text,
        grade: assessment.grade,
        words: assessment.words,
        scorable: assessment.scorable,
        exempt: isExempt(allowlist, text, relPath),
      });
    };

    const visit = (node) => {
      if (ts.isJsxText(node)) {
        record(node, node.text);
      } else if (ts.isStringLiteralLike(node) && isCopyCandidate(node)) {
        record(node, node.text);
      }
      ts.forEachChild(node, visit);
    };

    try {
      visit(sourceFile);
    } catch (err) {
      console.warn(`  [warn]  error walking ${relPath}: ${err.message}`);
    }
  }

  const scorable = candidates.filter((c) => c.scorable);
  const failures = scorable.filter((c) => c.grade > PLAIN_LANGUAGE_MAX_GRADE && !c.exempt);
  const exemptCount = candidates.filter((c) => c.exempt).length;
  const worst = scorable
    .filter((c) => !c.exempt)
    .slice()
    .sort((a, b) => b.grade - a.grade)
    .slice(0, TOP_WORST_COUNT);
  const medianGrade = median(scorable.map((c) => c.grade));

  console.log("UI-copy readability instrument");
  console.log(`Ceiling: PLAIN_LANGUAGE_MAX_GRADE=${PLAIN_LANGUAGE_MAX_GRADE}  Ideal: PLAIN_LANGUAGE_IDEAL_GRADE=${PLAIN_LANGUAGE_IDEAL_GRADE}\n`);
  console.log("Scan roots:");
  for (const note of rootNotes) console.log(note);
  console.log();

  if (failures.length > 0) {
    console.log(`Failures over the grade ceiling (${failures.length}):\n`);
    const byFile = new Map();
    for (const f of failures) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, items] of byFile) {
      console.log(`  ${file}`);
      for (const item of items.sort((a, b) => a.line - b.line)) {
        console.log(`    L${item.line}  grade ${item.grade.toFixed(1)}  "${truncate(item.text)}"`);
      }
    }
    console.log();
  } else {
    console.log("Failures over the grade ceiling: none\n");
  }

  console.log(`Top ${Math.min(TOP_WORST_COUNT, worst.length)} worst strings (Phase-2 rewrite worklist):\n`);
  worst.forEach((item, i) => {
    console.log(`  ${i + 1}. grade ${item.grade.toFixed(1)}  ${item.file}:${item.line}  "${truncate(item.text)}"`);
  });
  console.log();

  console.log("Summary:");
  console.log(`  files scanned:            ${files.length}`);
  console.log(`  candidate strings found:  ${candidates.length}`);
  console.log(`  scorable (>=12 words):    ${scorable.length}`);
  console.log(`  over ceiling (gating):    ${failures.length}`);
  console.log(`  allowlist exemptions:     ${exemptCount}`);
  console.log(
    `  median grade (scorable):  ${medianGrade === null ? "n/a" : medianGrade.toFixed(1)} (ideal target: ${PLAIN_LANGUAGE_IDEAL_GRADE}, ceiling: ${PLAIN_LANGUAGE_MAX_GRADE})`,
  );
  console.log();

  if (gate) {
    if (failures.length > 0) {
      console.log(`--gate: FAIL — ${failures.length} scorable string(s) exceed grade ${PLAIN_LANGUAGE_MAX_GRADE}.`);
      process.exitCode = 1;
      return;
    }
    console.log("--gate: PASS — no scorable strings exceed the ceiling.");
    return;
  }

  console.log("Report mode — exiting 0. Pass --gate to fail on ceiling violations.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
