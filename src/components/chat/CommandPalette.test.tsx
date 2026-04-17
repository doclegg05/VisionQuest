import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const html = renderToString(
      <CommandPalette
        open={false}
        input="/"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.equal(html, "");
  });

  it("renders student commands when open with student role", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/goal"), "expected /goal in markup");
    assert.ok(html.includes("Set a goal"), "expected label in markup");
  });

  it("filters list when input is more specific", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/go"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/goal"));
    assert.ok(!html.includes("/reflect"), "should not include non-matching commands");
  });

  it("renders empty-state message when no commands match", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/xyz-nomatch"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.toLowerCase().includes("no matching"));
  });

  it("only shows commands for the current role", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/"
        role="admin"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/audit"), "admin command present");
    assert.ok(!html.includes("/goal"), "student command absent");
  });
});
