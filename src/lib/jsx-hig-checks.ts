import ts from "typescript";

/**
 * Static HIG checks over TSX source, used by guard tests. They read the JSX
 * tree with the TypeScript parser, so they see attributes and nesting rather
 * than guessing from text.
 */

export interface JsxViolation {
  line: number;
  element: string;
  detail: string;
}

function attribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

function hasSpread(node: ts.JsxOpeningLikeElement): boolean {
  return node.attributes.properties.some(ts.isJsxSpreadAttribute);
}

/**
 * `const NAME = "classes"` declarations in the file, so `${NAME}` in a className
 * can be read. A template literal counts too: earlier constants are inlined
 * (`const ROW_DELETE = \`${ROW} text-red\``) and runtime parts are dropped.
 */
function stringConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  const valueOf = (init: ts.Expression): string | null => {
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    if (ts.isTemplateExpression(init)) {
      // Known constants are inlined; a runtime part contributes nothing, but the
      // literal classes around it still count.
      const spans = init.templateSpans.map((s) => {
        const known = ts.isIdentifier(s.expression) ? constants.get(s.expression.text) : undefined;
        return `${known ?? " "}${s.literal.text}`;
      });
      return init.head.text + spans.join("");
    }
    return null;
  };
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isVariableDeclarationList(n.parent) &&
      (n.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const value = valueOf(n.initializer);
      if (value !== null) constants.set(n.name.text, value);
    }
    n.forEachChild(visit);
  };
  visit(source);
  return constants;
}

const MAX_VARIANTS = 64;

function product(parts: string[][]): string[] {
  return parts.reduce<string[]>((acc, options) => acc.flatMap((a) => options.map((o) => `${a} ${o}`)), [""]);
}

/**
 * Every class string an expression can produce: each side of `?:`, the right
 * side of `&&` or nothing, both sides of `||`/`??`, and the combinations
 * across template spans, `+`, `[...].join()`, and `cn()`/`clsx()` arguments.
 * Unknown parts contribute nothing. Returns null past MAX_VARIANTS.
 */
function expressionVariants(n: ts.Expression, constants: Map<string, string>): string[] | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (ts.isIdentifier(n)) return [constants.get(n.text) ?? ""];
  if (ts.isParenthesizedExpression(n)) return expressionVariants(n.expression, constants);
  if (ts.isConditionalExpression(n)) {
    const a = expressionVariants(n.whenTrue, constants);
    const b = expressionVariants(n.whenFalse, constants);
    return a && b ? [...a, ...b] : null;
  }
  const combine = (exprs: readonly ts.Expression[], literals: string[] = []): string[] | null => {
    const parts = exprs.map((e) => expressionVariants(e, constants));
    if (parts.some((p) => p === null)) return null;
    const size = (parts as string[][]).reduce((acc, p) => acc * p.length, 1);
    if (size > MAX_VARIANTS) return null;
    return product([...literals.map((l) => [l]), ...(parts as string[][])]);
  };
  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const right = expressionVariants(n.right, constants);
      return right ? [...right, ""] : null;
    }
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      const a = expressionVariants(n.left, constants);
      const b = expressionVariants(n.right, constants);
      return a && b ? [...a, ...b] : null;
    }
    if (op === ts.SyntaxKind.PlusToken) return combine([n.left, n.right]);
    return [""];
  }
  if (ts.isTemplateExpression(n)) {
    const literals = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
    return combine(n.templateSpans.map((s) => s.expression), literals);
  }
  if (ts.isCallExpression(n)) {
    const callee = n.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "join" && ts.isArrayLiteralExpression(callee.expression)) {
      return combine(callee.expression.elements.filter((e): e is ts.Expression => !ts.isSpreadElement(e)));
    }
    return combine(n.arguments);
  }
  if (ts.isArrayLiteralExpression(n)) return combine(n.elements.filter((e): e is ts.Expression => !ts.isSpreadElement(e)));
  return [""];
}

/** The class strings an element can render with, or null when they cannot be read statically. */
function classVariants(node: ts.JsxOpeningLikeElement, constants: Map<string, string>): string[] | null {
  const init = attribute(node, "className")?.initializer;
  if (!init) return null;
  const variants = ts.isStringLiteral(init)
    ? [init.text]
    : ts.isJsxExpression(init) && init.expression
      ? expressionVariants(init.expression, constants)
      : null;
  // Nothing literal in any variant means the classes are computed elsewhere.
  if (!variants || variants.every((v) => v.trim() === "")) return null;
  return variants.map((v) => v.replace(/\s+/g, " ").trim());
}

/** Every string inside a className expression, joined: literals and same-file constants. */
function classText(node: ts.JsxOpeningLikeElement, constants: Map<string, string>): string | null {
  const variants = classVariants(node, constants);
  return variants ? variants.join(" ") : null;
}

function staticAttr(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const init = attribute(node, name)?.initializer;
  if (init && ts.isStringLiteral(init)) return init.text;
  return undefined;
}

function line(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function walkJsx(source: ts.SourceFile, fn: (node: ts.JsxOpeningLikeElement, tag: string) => void): void {
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) fn(n, n.tagName.getText(source));
    n.forEachChild(visit);
  };
  visit(source);
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const TALL_ENOUGH = /(?:^|\s)(?:pointer-coarse:)?(?:min-h|h|size)-(?:1[1-9]|[2-9]\d|\[(?:4[4-9]|[5-9]\d)px\])(?=\s|$)/;
// A fixed height under 44px sets the height, whatever the padding (border-box).
const FIXED_SMALL = /^(?:h|size)-(?:[1-9]|10|\[(?:[1-3]?\d|4[0-3])px\])$/;
// min-height does nothing on an inline element, which <a> is by default.
// .primary-button and .secondary-button set display: inline-flex in globals.css.
const BOX_DISPLAY = /^(?:block|flex|inline-flex|grid|inline-grid|inline-block|table|primary-button|secondary-button)$/;
const FLEX_OR_GRID = /(?:^|\s)(?:flex|inline-flex|grid|inline-grid)(?=\s|$)/;

// Tailwind 4 type scale: font size and line height in px. The body inherits 16px / 24px.
const TYPE_SCALE: Record<string, [number, number]> = {
  xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [20, 28], "2xl": [24, 32], "3xl": [30, 36],
};
const NAMED_LEADING: Record<string, number> = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };

/** Last unprefixed class matching `re` (variants such as `md:` or `hover:` do not apply at rest on a phone). */
function lastClass(classes: string, re: RegExp): RegExpMatchArray | null {
  return classes.split(/\s+/).filter((c) => !c.includes(":")).map((c) => c.match(re)).filter((m): m is RegExpMatchArray => m !== null).pop() ?? null;
}

/** Rendered height of a one-line control: vertical padding + line height + border, in px. */
export function estimatedHeight(classes: string): number {
  const size = lastClass(classes, /^text-(xs|sm|base|lg|xl|2xl|3xl)$/);
  const [fontPx, linePx] = TYPE_SCALE[size?.[1] ?? "base"];
  const leading = lastClass(classes, /^leading-(\d+|none|tight|snug|normal|relaxed|loose)$/);
  const line = leading ? (/^\d+$/.test(leading[1]) ? Number(leading[1]) * 4 : fontPx * NAMED_LEADING[leading[1]]) : linePx;
  const spacing = (re: RegExp) => { const m = lastClass(classes, re); return m ? Number(m[1]) * 4 : null; };
  const p = spacing(/^p-(\d+(?:\.5)?)$/);
  const py = spacing(/^py-(\d+(?:\.5)?)$/);
  const top = spacing(/^pt-(\d+(?:\.5)?)$/) ?? py ?? p ?? 0;
  const bottom = spacing(/^pb-(\d+(?:\.5)?)$/) ?? py ?? p ?? 0;
  const border = lastClass(classes, /^border-2$/) ? 4 : lastClass(classes, /^border$/) ? 2 : 0;
  return top + bottom + line + border;
}

/** The nearest JSX element that contains this one, through any {cond && ...} wrappers. */
function enclosingElement(node: ts.JsxOpeningLikeElement): ts.JsxElement | null {
  let current: ts.Node | undefined = ts.isJsxOpeningElement(node) ? node.parent.parent : node.parent;
  while (current && !ts.isJsxElement(current)) current = current.parent;
  return current ?? null;
}

function tooSmall(classes: string, tag: string, inFlexOrGrid: boolean): boolean {
  const tokens = classes.split(" ").filter((c) => !c.includes(":"));
  if (tokens.includes("sr-only")) return false;
  // A flex or grid child is blockified, so its min-height applies.
  const boxed = tag === "button" || inFlexOrGrid || tokens.some((c) => BOX_DISPLAY.test(c));
  if (TALL_ENOUGH.test(classes) && boxed) return false;
  if (tokens.some((c) => FIXED_SMALL.test(c))) return true;
  return estimatedHeight(classes) < 44;
}

/**
 * Buttons and links that would render under 44pt on a touch screen: no height
 * class of 44px or more, and an estimated height (vertical padding + line
 * height of their text size + border) under 44px. `pointer-coarse:min-h-11`
 * counts, which keeps the compact look for a mouse; on a link it counts only
 * with a box display, since min-height does nothing inline. A fixed h-/size-
 * under 44px fails whatever the padding. Each class combination a conditional
 * className can produce is judged on its own. Visually hidden elements, fully
 * dynamic classNames, and links marked `data-inline-link` (a link inside
 * running text, exempt under WCAG 2.5.8) are skipped.
 */
export function undersizedTargets(fileName: string, text: string): JsxViolation[] {
  const source = parse(fileName, text);
  const constants = stringConstants(source);
  const out: JsxViolation[] = [];
  walkJsx(source, (node, tag) => {
    if (!["button", "a", "Link"].includes(tag)) return;
    // WCAG 2.5.8 exempts links inside a sentence; the marker makes the exemption explicit.
    if (tag !== "button" && attribute(node, "data-inline-link")) return;
    const hasClassName = attribute(node, "className") !== undefined;
    if (!hasClassName && hasSpread(node)) return;
    const variants = hasClassName ? classVariants(node, constants) : [""];
    if (variants === null) return;
    const parent = enclosingElement(node);
    const parentClasses = parent ? classText(parent.openingElement, constants) : null;
    const inFlexOrGrid = parentClasses !== null && FLEX_OR_GRID.test(parentClasses.split(" ").filter((c) => !c.includes(":")).join(" "));
    if (variants.some((classes) => tooSmall(classes, tag, inFlexOrGrid))) {
      out.push({ line: line(source, node), element: tag, detail: "under 44pt on touch; add min-h-11 or pointer-coarse:min-h-11" });
    }
  });
  return out;
}

const UNLABELLED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/**
 * Form fields with no accessible name: no aria-label, no aria-labelledby, not
 * inside a <label>, and no <label htmlFor> pointing at their id. A placeholder
 * or title is not a label. Fields with spread props are skipped.
 */
export function unlabelledFields(fileName: string, text: string): JsxViolation[] {
  const source = parse(fileName, text);
  const htmlFors = new Set<string>();
  walkJsx(source, (node, tag) => {
    if (tag !== "label") return;
    const init = attribute(node, "htmlFor")?.initializer;
    if (init) htmlFors.add(init.getText(source).replace(/^\{|\}$/g, "").trim());
  });

  const out: JsxViolation[] = [];
  walkJsx(source, (node, tag) => {
    if (!["input", "select", "textarea"].includes(tag) || hasSpread(node)) return;
    if (tag === "input" && UNLABELLED_TYPES.has(staticAttr(node, "type") ?? "")) return;
    if (attribute(node, "aria-label") || attribute(node, "aria-labelledby")) return;

    let parent: ts.Node | undefined = node.parent;
    while (parent) {
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "label") return;
      parent = parent.parent;
    }

    const id = attribute(node, "id")?.initializer;
    if (id && htmlFors.has(id.getText(source).replace(/^\{|\}$/g, "").trim())) return;

    out.push({ line: line(source, node), element: tag, detail: "no label; wrap in <label>, add <label htmlFor>, or aria-label" });
  });
  return out;
}

const INLINE_TAGS = new Set(["span", "a", "strong", "em", "small", "b", "i", "abbr", "label"]);
// Not `contents`: an element with display: contents takes no margin either.
const DISPLAY_CLASS = /(?:^|\s)(?:block|flex|inline-flex|grid|inline-grid|inline-block|table|hidden|sr-only)(?=\s|$)/;

/**
 * Inline children of a `space-y-*` parent. Tailwind 4 spaces a stack with a
 * bottom margin on every child but the last, and a vertical margin does
 * nothing on an inline element, so a `<span>` label text sits flush against
 * its field. Give the child `block` (or any display class).
 */
export function inlineSpacedChildren(fileName: string, text: string): JsxViolation[] {
  const source = parse(fileName, text);
  const constants = stringConstants(source);
  const out: JsxViolation[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && /(?:^|\s)space-y-/.test(classText(n.openingElement, constants) ?? "")) {
      const children = n.children.filter((c): c is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      for (const child of children.slice(0, -1)) {
        const open = ts.isJsxElement(child) ? child.openingElement : child;
        const tag = open.tagName.getText(source);
        if (INLINE_TAGS.has(tag) && !DISPLAY_CLASS.test(classText(open, constants) ?? "")) {
          out.push({ line: line(source, open), element: tag, detail: "inline child of a space-y stack gets no spacing; add block" });
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(source);
  return out;
}
