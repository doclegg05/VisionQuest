// scripts/lib/spokes-source-rewrite.mjs
/**
 * Applies rewriteClassList to every string literal and template-literal piece
 * in a .ts or .tsx file, found through the TypeScript AST so object keys and
 * template pieces are covered. Class names assembled from template expressions
 * cannot be mapped safely and are returned for hand review.
 */
import ts from "typescript";
import { ALL_RULES, HUES, rewriteClassList } from "./spokes-class-map.mjs";

const TEMPLATE_BUILT = [
  /(?:^|[\s"'`:])(?:bg|text|border|ring|fill|stroke|from|via|to)-$/,
  new RegExp(`-(?:${HUES})-$`),
];

export function rewriteSource(source, fileName, rules = ALL_RULES) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const changes = [];
  const review = [];
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1;

  function handle(start, end, isTemplatePiece) {
    const raw = source.slice(start, end);
    const line = lineOf(start);
    if (isTemplatePiece && TEMPLATE_BUILT.some((re) => re.test(raw))) {
      review.push({ line, token: raw.trim().slice(-40), reason: "class name built from a template expression" });
    }
    const result = rewriteClassList(raw, rules);
    for (const change of result.changes) changes.push({ line, ...change });
    for (const item of result.review) review.push({ line, ...item });
    if (result.output !== raw) edits.push({ start, end, text: result.output });
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, false);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) handle(node.getStart(file) + 1, node.getEnd() - 2, true);
    else if (ts.isTemplateTail(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, true);
    ts.forEachChild(node, visit);
  }

  visit(file);
  const output = [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  return { output, changes, review };
}
