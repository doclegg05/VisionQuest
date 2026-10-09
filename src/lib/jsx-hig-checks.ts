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
const SMALL_PADDING = /(?:^|\s)(?:py-(?:0|0\.5|1|1\.5)|p-(?:0\.5|1|1\.5))(?=\s|$)/;
const ANY_PADDING = /(?:^|\s)(?:p|py|px|pt|pb)-/;

/**
 * Buttons and links that would render under 44pt on a touch screen: small or
 * no padding, and no height class of 44px or more. `pointer-coarse:min-h-11`
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
    if (SMALL_PADDING.test(classes) || !ANY_PADDING.test(classes)) {
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
