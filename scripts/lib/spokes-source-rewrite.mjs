// scripts/lib/spokes-source-rewrite.mjs
/**
 * Applies rewriteClassList to every string literal and template-literal piece
 * in a .ts or .tsx file, found through the TypeScript AST so object keys and
 * template pieces are covered. Class names assembled from template expressions
 * cannot be mapped safely and are returned for hand review. A class that touches
 * a template expression is never rewritten, because the expression can extend it.
 */
import ts from "typescript";
import { ALL_RULES, HUE_PREFIX, HUES, rewriteClassList } from "./spokes-class-map.mjs";

const TEMPLATE_BUILT = [
  new RegExp(`(?:^|[\\s"'\`:])(?:${HUE_PREFIX})-$`),
  new RegExp(`-(?:${HUES})-\\d*$`),
];
const TEMPLATE_REASON = "class name built from a template expression";
const EDGE_REASON = "class touches a template expression; rewrite by hand";
const PLAIN = Object.freeze({ touchLeft: false, touchRight: false });
const TEMPLATE_HEAD = Object.freeze({ touchLeft: false, touchRight: true });
const TEMPLATE_MIDDLE = Object.freeze({ touchLeft: true, touchRight: true });
const TEMPLATE_TAIL = Object.freeze({ touchLeft: true, touchRight: false });

// A piece's first class continues the expression before it when no whitespace separates them, and its last
// class continues the expression after it. Those edge tokens are returned with their offsets, not rewritten.
function splitPiece(raw, touchLeft, touchRight) {
  const parts = raw.split(/(\s+)/);
  const last = parts.length - 1;
  const left = touchLeft && parts[0] !== "";
  const right = touchRight && parts[last] !== "";
  if (last === 0 && (left || right)) return { leftText: raw, middle: "", rightText: "", edges: [{ token: raw, offset: 0 }] };
  const edges = [];
  if (left) edges.push({ token: parts[0], offset: 0 });
  if (right) edges.push({ token: parts[last], offset: raw.length - parts[last].length });
  return {
    leftText: left ? parts[0] : "",
    middle: parts.slice(left ? 1 : 0, right ? last : parts.length).join(""),
    rightText: right ? parts[last] : "",
    edges,
  };
}

// An edge class is judged with its whole piece, because a rule can depend on the rest of the list
// (display-weight needs the display font in the same list). Only the verdict is kept; the output is discarded.
function edgeIsFlagged(raw, token, rules) {
  const result = rewriteClassList(raw, rules);
  return result.changes.some((change) => change.from === token) || result.review.some((item) => item.token === token);
}

// A class is built from an expression only when an expression follows it, and only a hue rule could change it.
function isBuiltBeforeExpression(raw, touchRight, rules) {
  return touchRight && !/\s$/.test(raw) && rules.includes("hue") && TEMPLATE_BUILT.some((re) => re.test(raw));
}

export function rewriteSource(source, fileName, rules = ALL_RULES) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const changes = [];
  const review = [];
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1;

  function handle(start, end, kindOfPiece) {
    const raw = source.slice(start, end);
    const lineAt = (offset) => lineOf(start + offset);
    const lineOfToken = (token) => lineAt(Math.max(0, raw.indexOf(token)));
    if (isBuiltBeforeExpression(raw, kindOfPiece.touchRight, rules)) {
      const token = raw.trim().slice(-40);
      review.push({ line: lineOfToken(token), token, reason: TEMPLATE_REASON });
    }
    const split = splitPiece(raw, kindOfPiece.touchLeft, kindOfPiece.touchRight);
    for (const edge of split.edges) {
      if (edgeIsFlagged(raw, edge.token, rules)) review.push({ line: lineAt(edge.offset), token: edge.token, reason: EDGE_REASON });
    }
    const result = rewriteClassList(split.middle, rules);
    for (const change of result.changes) changes.push({ line: lineOfToken(change.from), ...change });
    for (const item of result.review) review.push({ line: lineOfToken(item.token), ...item });
    const output = split.leftText + result.output + split.rightText;
    if (output !== raw) edits.push({ start, end, text: output });
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, PLAIN);
    else if (ts.isTemplateHead(node)) handle(node.getStart(file) + 1, node.getEnd() - 2, TEMPLATE_HEAD);
    else if (ts.isTemplateMiddle(node)) handle(node.getStart(file) + 1, node.getEnd() - 2, TEMPLATE_MIDDLE);
    else if (ts.isTemplateTail(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, TEMPLATE_TAIL);
    ts.forEachChild(node, visit);
  }

  visit(file);
  const output = [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  return { output, changes, review };
}
