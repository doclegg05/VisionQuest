import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveTabForAnchor,
  STUDENT_DETAIL_ANCHOR_TO_TAB,
} from "./useAnchorTabSwitch";

describe("resolveTabForAnchor", () => {
  const map = {
    "case-notes": "coach",
    "certification-review": "progress",
    "account-actions": "admin",
  } as const;

  it("returns the mapped tab for a known anchor", () => {
    assert.equal(resolveTabForAnchor("case-notes", map), "coach");
    assert.equal(resolveTabForAnchor("certification-review", map), "progress");
    assert.equal(resolveTabForAnchor("account-actions", map), "admin");
  });

  it("strips a leading hash from the input", () => {
    assert.equal(resolveTabForAnchor("#case-notes", map), "coach");
  });

  it("returns null for an unknown anchor", () => {
    assert.equal(resolveTabForAnchor("bogus", map), null);
  });

  it("returns null for an empty anchor", () => {
    assert.equal(resolveTabForAnchor("", map), null);
  });
});

describe("student detail career anchor ownership", () => {
  it("opens career discovery on Coach, where the section renders", () => {
    assert.equal(
      resolveTabForAnchor("#career-discovery", STUDENT_DETAIL_ANCHOR_TO_TAB),
      "coach",
    );
  });

  it("opens career progress on Progress, where the section renders", () => {
    assert.equal(
      resolveTabForAnchor("#career-progress", STUDENT_DETAIL_ANCHOR_TO_TAB),
      "progress",
    );
  });
});

describe("STUDENT_DETAIL_ANCHOR_TO_TAB integrity", () => {
  it("maps only anchors whose ids render in the student-detail tree", () => {
    // A key with no rendered id="…" is a dead anchor: the tab switches but
    // nothing scrolls into view. Check the sources on disk so future keys
    // cannot go dead silently.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const sourcePaths = [
      // Tab components in this directory (skip .ts so the map's own source
      // in useAnchorTabSwitch.ts cannot satisfy the check).
      ...readdirSync(testDir)
        .filter((fileName) => fileName.endsWith(".tsx"))
        .map((fileName) => join(testDir, fileName)),
      // The parent component that renders the admin sections.
      join(testDir, "..", "StudentDetail.tsx"),
    ];
    const renderedSource = sourcePaths
      .map((sourcePath) => readFileSync(sourcePath, "utf8"))
      .join("\n");

    for (const anchor of Object.keys(STUDENT_DETAIL_ANCHOR_TO_TAB)) {
      assert.ok(
        renderedSource.includes(`id="${anchor}"`),
        `Anchor "${anchor}" has no rendered id="${anchor}" in the student-detail sources`,
      );
    }
  });

  it("covers every student-detail deep link emitted anywhere in src", () => {
    // The reverse direction: a link built as /teacher/students/${…}#anchor
    // that is NOT in the map silently no-ops (tab never switches). This is
    // the direction the actual bugs traveled (#spokes-profile, #tasks).
    const testDir = dirname(fileURLToPath(import.meta.url));
    const srcRoot = join(testDir, "..", "..", "..");
    const sourceFiles = readdirSync(srcRoot, { recursive: true })
      .map(String)
      .filter(
        (relPath) =>
          (relPath.endsWith(".ts") || relPath.endsWith(".tsx")) &&
          !relPath.endsWith(".test.ts") &&
          !relPath.endsWith(".test.tsx"),
      );

    const mappedAnchors = new Set(Object.keys(STUDENT_DETAIL_ANCHOR_TO_TAB));
    // Literal anchors on the student-detail base route only — links to
    // sub-routes like /teacher/students/${id}/spokes carry no anchor and
    // dynamic anchors (#${…}) do not match the literal character class.
    const deepLinkPattern = /\/teacher\/students\/\$\{[^}]+\}#([a-z0-9-]+)/g;

    for (const relPath of sourceFiles) {
      const source = readFileSync(join(srcRoot, relPath), "utf8");
      for (const match of source.matchAll(deepLinkPattern)) {
        assert.ok(
          mappedAnchors.has(match[1]),
          `${relPath} deep-links to unmapped anchor "#${match[1]}" — add it to STUDENT_DETAIL_ANCHOR_TO_TAB (with a rendered id) or fix the link`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tab-scoped rendering
//
// The two suites above prove an anchor's id renders SOMEWHERE in the
// student-detail tree, and that every emitted deep link is mapped. Neither
// checks that the id renders under the TAB the map claims. That gap is
// exactly how "follow-up-tasks": "admin" shipped: the id exists in
// OperationsTab.tsx (source-on-disk check passes), and the anchor is
// mapped (reverse-direction check passes) — but OperationsTab only renders
// that section when its `scope` prop is "coaching" or "all", and the Admin
// tab instantiates it with `scope="submittedForms"`. A teacher following the
// "Add task" intervention-queue link landed on Admin with nothing to scroll
// to.
//
// This suite is a tiny source-level evaluator of StudentDetail.tsx's
// per-tab JSX: for each tab, it resolves which components render there
// (and with which literal props), then — for components like OperationsTab
// that gate whole sections behind `{someFlag && (...)}` where
// `someFlag = <prop> === "<literal>"` — masks out the sections whose flag
// evaluates to false for the props actually passed at that call site. It is
// deliberately generic (no per-anchor hardcoding): it re-derives rendering
// from the same `scope` prop the components themselves branch on, so it
// stays accurate as sections move between tabs instead of needing a parallel
// hand-maintained map that can itself go stale.
describe("STUDENT_DETAIL_ANCHOR_TO_TAB tab-scoped rendering", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const componentDir = testDir;
  const studentDetailPath = join(testDir, "..", "StudentDetail.tsx");

  /** Slice out the balanced-paren expression starting at the char index of `openParenIndex`. */
  function sliceBalancedParens(source: string, openParenIndex: number): { start: number; end: number } {
    let depth = 0;
    let i = openParenIndex;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    assert.ok(depth === 0, "Unbalanced parentheses while scanning StudentDetail.tsx — has its structure changed?");
    return { start: openParenIndex + 1, end: i };
  }

  /** Slice out the balanced-brace object starting at the char index of `openBraceIndex`. */
  function sliceBalancedBraces(source: string, openBraceIndex: number): { start: number; end: number } {
    let depth = 0;
    let i = openBraceIndex;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    assert.ok(depth === 0, "Unbalanced braces while scanning a component's destructured params — has its signature changed?");
    return { start: openBraceIndex, end: i + 1 };
  }

  /** Extract the JSX assigned to `<tabKey>: ( ... )` in the StudentDetailTabs children object. */
  function extractTabBlock(studentDetailSource: string, tabKey: string): string {
    const marker = `${tabKey}: (`;
    const markerIndex = studentDetailSource.indexOf(marker);
    assert.ok(markerIndex !== -1, `Could not find "${marker}" in StudentDetail.tsx — has the tab object shape changed?`);
    const openParenIndex = markerIndex + marker.length - 1;
    const { start, end } = sliceBalancedParens(studentDetailSource, openParenIndex);
    return studentDetailSource.slice(start, end);
  }

  interface ComponentUsage {
    name: string;
    props: Record<string, string>;
  }

  /** Find every `<ComponentName ...>` JSX usage in a block, with its literal string props. */
  function findComponentUsages(block: string): ComponentUsage[] {
    const usages: ComponentUsage[] = [];
    const tagPattern = /<([A-Z][A-Za-z0-9]*)\b([^>]*)>/g;
    for (const tagMatch of block.matchAll(tagPattern)) {
      const [, name, attrText] = tagMatch;
      const props: Record<string, string> = {};
      const propPattern = /(\w+)="([^"]*)"/g;
      for (const propMatch of attrText.matchAll(propPattern)) {
        props[propMatch[1]] = propMatch[2];
      }
      usages.push({ name, props });
    }
    return usages;
  }

  /** Read a sibling component's source by its JSX tag name, or null if it isn't a local file. */
  function resolveComponentSource(name: string): string | null {
    try {
      return readFileSync(join(componentDir, `${name}.tsx`), "utf8");
    } catch {
      return null;
    }
  }

  /** The object literal a component destructures its props from, e.g. `{ data, scope = "all" }`. */
  function extractParamsBlock(componentSource: string): string {
    const fnIndex = componentSource.indexOf("export default function");
    if (fnIndex === -1) return "";
    const braceIndex = componentSource.indexOf("{", fnIndex);
    if (braceIndex === -1) return "";
    const { start, end } = sliceBalancedBraces(componentSource, braceIndex);
    return componentSource.slice(start, end);
  }

  /** Default prop values declared in the destructuring, e.g. `scope = "all"` -> { scope: "all" }. */
  function extractDefaultProps(paramsBlock: string): Record<string, string> {
    const defaults: Record<string, string> = {};
    for (const match of paramsBlock.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
      defaults[match[1]] = match[2];
    }
    return defaults;
  }

  /**
   * Evaluate `const <name> = <prop> === "<literal>" || <prop> === "<literal>";`
   * guards against the resolved prop values. Guards this pattern can't parse
   * are left out of the result (never masked), so an unrecognized expression
   * fails open rather than silently hiding a section.
   */
  function evaluateBooleanGuards(
    componentSource: string,
    propValues: Record<string, string>,
  ): Record<string, boolean> {
    const guards: Record<string, boolean> = {};
    for (const match of componentSource.matchAll(/const\s+(\w+)\s*=\s*([^;]+);/g)) {
      const [, name, expr] = match;
      if (!expr.includes("===")) continue;
      const clauses = expr.split("||").map((clause) => clause.trim());
      let resolvable = true;
      let value = false;
      for (const clause of clauses) {
        const clauseMatch = clause.match(/^(\w+)\s*===\s*"([^"]*)"$/);
        if (!clauseMatch) {
          resolvable = false;
          break;
        }
        const [, propName, literal] = clauseMatch;
        if (propValues[propName] === literal) value = true;
      }
      if (resolvable) guards[name] = value;
    }
    return guards;
  }

  /** Strip out every `{<guardName> && ( ... )}` block whose guard evaluated false. */
  function maskFalseGuardedBlocks(componentSource: string, guards: Record<string, boolean>): string {
    let result = componentSource;
    for (const [name, value] of Object.entries(guards)) {
      if (value) continue;
      const marker = `{${name} && (`;
      let searchFrom = 0;
      for (;;) {
        const markerIndex = result.indexOf(marker, searchFrom);
        if (markerIndex === -1) break;
        const openParenIndex = markerIndex + marker.length - 1;
        const { end } = sliceBalancedParens(result, openParenIndex);
        const closeBraceIndex = result[end + 1] === "}" ? end + 2 : end + 1;
        result = result.slice(0, markerIndex) + result.slice(closeBraceIndex);
        searchFrom = markerIndex;
      }
    }
    return result;
  }

  function extractIds(source: string): Set<string> {
    const ids = new Set<string>();
    for (const match of source.matchAll(/id="([a-z0-9-]+)"/g)) {
      ids.add(match[1]);
    }
    return ids;
  }

  /** Resolve the set of DOM ids a single JSX component usage renders, honoring its scope-style props. */
  function renderedIdsForUsage(usage: ComponentUsage): Set<string> {
    const source = resolveComponentSource(usage.name);
    if (!source) return new Set(); // Not a local tab component (e.g. shared widgets) — contributes no ids.
    const defaults = extractDefaultProps(extractParamsBlock(source));
    const propValues = { ...defaults, ...usage.props };
    const guards = evaluateBooleanGuards(source, propValues);
    return extractIds(maskFalseGuardedBlocks(source, guards));
  }

  /** Resolve every DOM id that actually renders under a given StudentDetail tab. */
  function renderedIdsForTab(studentDetailSource: string, tab: string): Set<string> {
    const block = extractTabBlock(studentDetailSource, tab);
    const ids = extractIds(block); // ids written directly inline in StudentDetail.tsx for this tab
    for (const usage of findComponentUsages(block)) {
      for (const id of renderedIdsForUsage(usage)) ids.add(id);
    }
    return ids;
  }

  it("renders every mapped anchor's id inside the tab the map routes it to", () => {
    const studentDetailSource = readFileSync(studentDetailPath, "utf8");
    const tabs = [...new Set(Object.values(STUDENT_DETAIL_ANCHOR_TO_TAB))];
    const renderedByTab = new Map(tabs.map((tab) => [tab, renderedIdsForTab(studentDetailSource, tab)]));

    for (const [anchor, tab] of Object.entries(STUDENT_DETAIL_ANCHOR_TO_TAB)) {
      const renderedIds = renderedByTab.get(tab);
      assert.ok(renderedIds, `No renderer resolved for tab "${tab}"`);
      assert.ok(
        renderedIds.has(anchor),
        `Anchor "${anchor}" is mapped to tab "${tab}" in STUDENT_DETAIL_ANCHOR_TO_TAB, but ` +
          `id="${anchor}" does not render under that tab in StudentDetail.tsx (rendered ids for ` +
          `"${tab}": [${[...renderedIds].join(", ")}]). Either the map is wrong, or the section ` +
          `moved tabs and the map needs to follow it.`,
      );
    }
  });
});
