import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// The card refreshes the page after each saved change, which needs a mounted app router.
mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});

let RegionsCard: typeof import("./RegionsCard").RegionsCard;
before(async () => {
  ({ RegionsCard } = await import("./RegionsCard"));
});

// Effects do not run in a static render, so this is the card's first paint,
// before the list arrives. The loaded, empty and failed views are covered in
// RegionsCardView.test.tsx, and the requests in regions-controller.test.ts.
describe("RegionsCard first paint", () => {
  it("shows the heading and says the regions are loading", () => {
    const html = renderToString(<RegionsCard />);
    assert.ok(html.includes(">Regions</h2>"));
    assert.ok(html.includes("Loading regions"));
  });

  it("carries the confirm dialog that removing a coordinator uses", () => {
    assert.ok(renderToString(<RegionsCard />).includes('role="alertdialog"'));
  });
});
