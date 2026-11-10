/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

const mockGet = mock.fn() as any;
mock.module("@/lib/api", { namedExports: { api: { get: mockGet } } });

let details: typeof import("./FailedExtractionDetails");

before(async () => {
  details = await import("./FailedExtractionDetails");
});

const noop = () => {};

describe("FailureDetailsView", () => {
  it("offers a button and shows no reason before it is pressed", () => {
    const html = renderToString(<details.FailureDetailsView state={{ status: "idle" }} onShow={noop} />);
    assert.match(html, /<button type="button"/u);
    assert.match(html, /Show what went wrong/u);
  });

  it("disables the button while the details load", () => {
    const html = renderToString(<details.FailureDetailsView state={{ status: "loading" }} onShow={noop} />);
    assert.match(html, /disabled=""/u);
    assert.match(html, /Loading/u);
  });

  it("shows the reason once loaded, with no button", () => {
    const html = renderToString(
      <details.FailureDetailsView state={{ status: "loaded", reason: "The reply was not valid JSON." }} onShow={noop} />,
    );
    assert.match(html, /The reply was not valid JSON\./u);
    assert.doesNotMatch(html, /<button/u);
  });

  it("says the load failed and lets the teacher try again", () => {
    const html = renderToString(<details.FailureDetailsView state={{ status: "failed" }} onShow={noop} />);
    assert.match(html, /role="alert"/u);
    assert.match(html, /Try again/u);
  });
});

describe("fetchFailureReason", () => {
  beforeEach(() => mockGet.mock.resetCalls());

  it("reads one row from the detail route and returns its error text", async () => {
    mockGet.mock.mockImplementationOnce(async () => ({ success: true, data: { id: "fx1", error: "Timed out" } }));

    const reason = await details.fetchFailureReason("fx1");

    assert.equal(reason, "Timed out");
    assert.deepEqual(mockGet.mock.calls[0].arguments, ["/api/teacher/failed-extractions/fx1"]);
  });
});

describe("FailedExtractionsPanel", () => {
  const PANEL = readFileSync(path.join(process.cwd(), "src/components/teacher/FailedExtractionsPanel.tsx"), "utf8");

  it("no longer expects error text or a payload from the list", () => {
    assert.doesNotMatch(PANEL, /\berror: string;/u);
    assert.doesNotMatch(PANEL, /include=payload/u);
    assert.doesNotMatch(PANEL, /row\.error/u);
  });

  it("loads a row's details only when the teacher asks", () => {
    assert.match(PANEL, /fetchFailureReason\(row\.id\)/u);
    assert.match(PANEL, /<FailureDetailsView/u);
  });
});
