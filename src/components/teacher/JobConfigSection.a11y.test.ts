import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";

/**
 * The job-source toggles and the local-priority radio cards only render after
 * the class config loads over fetch, so renderToString never reaches them.
 * These checks read the JSX tree of the source instead.
 */

const FILE = path.join(process.cwd(), "src/components/teacher/JobConfigSection.tsx");
const SOURCE = ts.createSourceFile(
  FILE,
  readFileSync(FILE, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function openingElements(): ts.JsxOpeningLikeElement[] {
  const found: ts.JsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  return found;
}

function attributeText(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const attr = node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
  return attr?.initializer?.getText();
}

function single(predicate: (node: ts.JsxOpeningLikeElement) => boolean, what: string) {
  const matches = openingElements().filter(predicate);
  assert.equal(matches.length, 1, `expected exactly one ${what}, found ${matches.length}`);
  return matches[0];
}

const sourceToggle = () =>
  single(
    (n) => n.tagName.getText() === "button" && (attributeText(n, "onClick") ?? "").includes("toggleSource"),
    "job-source toggle button",
  );

const priorityCard = () =>
  single(
    (n) => n.tagName.getText() === "label" && (attributeText(n, "htmlFor") ?? "").includes("localJobPriority-"),
    "local-priority radio card",
  );

describe("JobConfigSection job-source toggles", () => {
  it("expose on/off state through aria-pressed, not color alone", () => {
    assert.equal(attributeText(sourceToggle(), "aria-pressed"), "{sources.includes(opt.value)}");
  });

  it("sit in a group named by the visible Job Sources heading", () => {
    const group = single((n) => attributeText(n, "role") === '"group"', 'role="group" container');
    const labelledBy = attributeText(group, "aria-labelledby");
    assert.ok(labelledBy, "the group has no aria-labelledby");
    const heading = single((n) => attributeText(n, "id") === labelledBy, `element with id=${labelledBy}`);
    assert.notEqual(heading.tagName.getText(), "label", "an unbound <label> names nothing");
  });
});

// --primary has no dark-mode value in globals.css, so text or tints drawn in
// it fall below 4.5:1 in dark mode. Selected states use the info badge pair.
describe("JobConfigSection selected states", () => {
  for (const [what, element] of [
    ["job-source toggle", sourceToggle],
    ["local-priority radio card", priorityCard],
  ] as const) {
    it(`${what} does not draw its selected state in --primary`, () => {
      assert.doesNotMatch(attributeText(element(), "className") ?? "", /--primary/);
    });
  }
});
