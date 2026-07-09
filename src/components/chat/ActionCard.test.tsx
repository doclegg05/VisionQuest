import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { ActionCard } from "./ActionCard";

describe("ActionCard", () => {
  it("renders title, description, Open form CTA, and Skip for open_form", () => {
    const html = renderToString(
      <ActionCard
        action="open_form"
        target="/api/forms/download?formId=student-profile&mode=view"
        label="Open Student Profile"
        title="Student Profile"
        description="Basic contact and program information."
      />,
    );

    assert.ok(html.includes("Student Profile"));
    assert.ok(html.includes("Basic contact and program information."));
    assert.ok(html.includes("Open form"));
    assert.ok(html.includes("Skip"));
    assert.ok(html.includes('href="/api/forms/download?formId=student-profile&amp;mode=view"'));
    assert.ok(html.includes('target="_blank"'));
  });

  it("uses Go there for navigate actions", () => {
    const html = renderToString(
      <ActionCard
        action="navigate"
        target="/goals"
        label="Open Goals"
        title="Goals"
        description="Your active goals and BHAG."
        dismissible={false}
      />,
    );

    assert.ok(html.includes("Go there"));
    assert.ok(!html.includes("Skip"));
    assert.ok(html.includes('href="/goals"'));
  });
});
