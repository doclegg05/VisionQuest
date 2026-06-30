import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogNode, extractSections } from "./parse";

const SAMPLE = `---
type: form
title: "Student Profile: Intake"
description: "Intake form: contact + demographic details"
resource: /api/forms/download?formId=student-profile&mode=view
tags: [onboarding, intake]
timestamp: 2026-06-30
vq_id: student-profile
vq_audience: BOTH
vq_category: onboarding
vq_storage_key: forms/Student-Profile.pdf
vq_status: draft
---
## When to use
At first arrival, for new enrollment.

## When NOT to use
Not for returning students — use the re-entry form.

## Related
Enrolls toward [Ready to Work](../certifications/ready-to-work.md).
`;

describe("parseCatalogNode", () => {
  it("parses frontmatter including values with colons", () => {
    const node = parseCatalogNode(SAMPLE, "catalog/forms/student-profile.md");
    assert.equal(node.frontmatter.type, "form");
    assert.equal(node.frontmatter.description, "Intake form: contact + demographic details");
    assert.deepEqual(node.frontmatter.tags, ["onboarding", "intake"]);
  });
  it("extracts the three body sections", () => {
    const node = parseCatalogNode(SAMPLE, "x.md");
    assert.match(node.sections.whenToUse, /first arrival/);
    assert.match(node.sections.whenNotToUse, /returning students/);
    assert.match(node.sections.related, /Ready to Work/);
  });
});

describe("extractSections", () => {
  it("returns empty strings for missing sections", () => {
    const s = extractSections("## When to use\nhi\n");
    assert.equal(s.whenToUse, "hi");
    assert.equal(s.whenNotToUse, "");
  });
});
