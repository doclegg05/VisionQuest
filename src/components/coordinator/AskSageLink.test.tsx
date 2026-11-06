import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AskSageLink, askSageActionFor } from "./AskSageLink";
import { COORDINATOR_ITEMS } from "@/components/ui/NavBar";

// The coordinator workspace's entry point into Sage chat (owner decision,
// 2026-11-06). It must open the same page the coordinator nav's Sage entry
// opens, inside the (coordinator) layout both coordinator roles can reach.
describe("AskSageLink", () => {
  it("is a labelled link to the coordinator Sage page", () => {
    const html = renderToStaticMarkup(<AskSageLink />);
    assert.match(html, /href="\/coordinator\/chat"/);
    assert.match(html, />Ask Sage</);
  });

  it("opens the page the coordinator nav's Sage entry opens", () => {
    const sage = COORDINATOR_ITEMS.find((item) => item.label === "Sage");
    assert.equal(sage?.href, "/coordinator/chat");
  });
});

// Admins can open /coordinator too, but they keep their own Sage at
// /admin/chat, so the workspace offers the link to coordinators only.
describe("askSageActionFor", () => {
  for (const role of ["coordinator", "program_coordinator"]) {
    it(`offers the Ask Sage link to a ${role}`, () => {
      const action = askSageActionFor(role);
      assert.ok(action, role);
      assert.match(renderToStaticMarkup(<>{action}</>), /href="\/coordinator\/chat"/);
    });
  }

  it("offers nothing to an admin", () => {
    assert.equal(askSageActionFor("admin"), null);
  });
});
