import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { StarterChips } from "./StarterChips";

describe("StarterChips", () => {
  it("renders 4 chips for student role", () => {
    const html = renderToString(<StarterChips role="student" onSelect={() => {}} />);
    const buttonCount = (html.match(/<button/g) ?? []).length;
    assert.equal(buttonCount, 4);
  });

  it("renders role-specific labels for teacher", () => {
    const html = renderToString(<StarterChips role="teacher" onSelect={() => {}} />);
    assert.ok(html.includes("Class snapshot"));
    assert.ok(!html.includes("Set a goal"));
  });

  it("renders role-specific labels for admin", () => {
    const html = renderToString(<StarterChips role="admin" onSelect={() => {}} />);
    assert.ok(html.includes("Outcomes"));
    assert.ok(!html.includes("Class snapshot"));
  });
});
