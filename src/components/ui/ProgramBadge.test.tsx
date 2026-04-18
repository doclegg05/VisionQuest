import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import ProgramBadge, { ProgramBadgeCompact } from "./ProgramBadge";
import { PROGRAM_LABELS } from "@/lib/program-type";

describe("ProgramBadge", () => {
  it("renders the short label for SPOKES", () => {
    const html = renderToString(<ProgramBadge programType="spokes" />);
    assert.ok(html.includes(PROGRAM_LABELS.spokes));
  });

  it("renders the short label for Adult Education", () => {
    const html = renderToString(<ProgramBadge programType="adult_ed" />);
    assert.ok(html.includes(PROGRAM_LABELS.adult_ed));
  });

  it("renders the short label for IETP", () => {
    const html = renderToString(<ProgramBadge programType="ietp" />);
    assert.ok(html.includes(PROGRAM_LABELS.ietp));
  });

  it("applies the program-specific color token for each program", () => {
    const spokes = renderToString(<ProgramBadge programType="spokes" />);
    const ae = renderToString(<ProgramBadge programType="adult_ed" />);
    const ietp = renderToString(<ProgramBadge programType="ietp" />);
    assert.ok(spokes.includes("--program-spokes-bg"));
    assert.ok(ae.includes("--program-ae-bg"));
    assert.ok(ietp.includes("--program-ietp-bg"));
  });

  it("exposes the full program name via aria-label", () => {
    const html = renderToString(<ProgramBadge programType="adult_ed" />);
    assert.ok(html.includes('aria-label="Program: Adult Education"'));
  });

  it("marks the icon aria-hidden so the label is the only announced text", () => {
    const html = renderToString(<ProgramBadge programType="spokes" />);
    assert.ok(html.includes('aria-hidden="true"'));
  });

  it("supports the sm size variant", () => {
    const html = renderToString(<ProgramBadge programType="ietp" size="sm" />);
    assert.ok(html.includes("text-[0.65rem]"));
  });
});

describe("ProgramBadgeCompact", () => {
  it("renders icon-only but keeps aria-label for assistive tech", () => {
    const html = renderToString(<ProgramBadgeCompact programType="spokes" />);
    assert.ok(html.includes('aria-label="Program: SPOKES"'));
    assert.ok(!html.includes("SPOKES</span>"));
  });
});
