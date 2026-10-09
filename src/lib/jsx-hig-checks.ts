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

/** `const NAME = "classes"` declarations in the file, so `${NAME}` in a className can be read. */
function stringConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) &&
      ts.isVariableDeclarationList(n.parent) &&
      (n.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      constants.set(n.name.text, n.initializer.text);
    }
    n.forEachChild(visit);
  };
  visit(source);
  return constants;
}

/** Every string inside a className expression, joined: literals and same-file constants. Other dynamic parts are ignored. */
function classText(node: ts.JsxOpeningLikeElement, constants: Map<string, string>): string | null {
  const attr = attribute(node, "className");
  if (!attr?.initializer) return null;
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && constants.has(n.text)) parts.push(constants.get(n.text) ?? "");
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
      n.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    n.forEachChild(visit);
  };
  visit(attr.initializer);
  // No literal at all means the classes are computed elsewhere; we cannot judge them.
  return parts.length === 0 ? null : parts.join(" ");
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

/**
 * Buttons and links that would render under 44pt on a touch screen: no height
 * class of 44px or more, and an estimated height (vertical padding + line
 * height of their text size + border) under 44px. `pointer-coarse:min-h-11`
 * counts, which keeps the compact look for a mouse. Visually hidden elements,
 * fully dynamic classNames, and links marked `data-inline-link` (a link inside
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
    const classes = classText(node, constants);
    if (classes === null || /(?:^|\s)sr-only(?=\s|$)/.test(classes)) return;
    if (TALL_ENOUGH.test(classes)) return;
    if (estimatedHeight(classes) < 44) {
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
const DISPLAY_CLASS = /(?:^|\s)(?:block|flex|inline-flex|grid|inline-grid|inline-block|table|contents|hidden|sr-only)(?=\s|$)/;

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
