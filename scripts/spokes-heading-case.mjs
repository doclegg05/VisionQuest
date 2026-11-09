// node scripts/spokes-heading-case.mjs --paths=<glob>[,...] [--write]
// Title-cases literal text directly inside h1, h2, h3, and .page-title elements.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { isSentence, titleCase } from "./lib/title-case.mjs";

const args = process.argv.slice(2);
const paths = args.find((a) => a.startsWith("--paths="))?.slice(8);
if (!paths) {
  console.error("usage: node scripts/spokes-heading-case.mjs --paths=<glob>[,...] [--write]");
  process.exit(2);
}
const write = args.includes("--write");
const HEADINGS = new Set(["h1", "h2", "h3"]);

function isHeading(element) {
  const opening = element.openingElement;
  if (HEADINGS.has(opening.tagName.getText())) return true;
  return opening.attributes.properties.some(
    (attr) => ts.isJsxAttribute(attr) && attr.name.getText() === "className" && attr.initializer && /\bpage-title\b/.test(attr.initializer.getText()),
  );
}

function headingEdits(file) {
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && isHeading(node)) {
      for (const child of node.children) {
        const literal = ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression) ? child.expression : null;
        const target = ts.isJsxText(child) && child.getText().trim() ? child : literal;
        if (!target) continue;
        const start = target.getStart(file) + (literal ? 1 : 0);
        const end = target.getEnd() - (literal ? 1 : 0);
        const before = file.text.slice(start, end);
        if (isSentence(before)) continue;
        const after = titleCase(before);
        if (after !== before) edits.push({ start, end, before, after, line: file.getLineAndCharacterOfPosition(start).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits;
}

const files = [...new Set(paths.split(",").flatMap((glob) => globSync(glob)))].filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f)).sort();
let changed = 0;
for (const name of files) {
  const source = readFileSync(name, "utf8");
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = headingEdits(file);
  for (const e of edits) console.log(`${name}:${e.line}  "${e.before.trim()}" -> "${e.after.trim()}"`);
  if (edits.length === 0) continue;
  changed += 1;
  const output = [...edits].sort((a, b) => b.start - a.start).reduce((text, e) => text.slice(0, e.start) + e.after + text.slice(e.end), source);
  if (write) writeFileSync(name, output);
}
console.log(`${write ? "rewrote" : "would rewrite"} ${changed} file(s)`);
