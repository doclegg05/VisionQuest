import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import MemoryPage from "./page";

describe("MemoryPage", () => {
  it("tells the student their teacher can see and fix these notes, without the vague 'already ... every student' framing", () => {
    const html = renderToString(<MemoryPage />);
    assert.ok(html.includes("Your teacher can see these notes too"));
    assert.ok(html.includes("they can fix it or"));
    assert.ok(!html.includes("Teachers can already see and correct these notes"));
  });

  it("gives a real 44px affordance to book time with the teacher, next to the correction prose", () => {
    const html = renderToString(<MemoryPage />);
    assert.match(html, /href="\/appointments"/);
    assert.ok(html.includes("Book time with your teacher"));

    // The link itself (not just something elsewhere on the page) carries the
    // 44px touch target — isolate the <a href="/appointments" ...> tag and
    // check its own class list.
    const anchorMatch = html.match(/<a [^>]*href="\/appointments"[^>]*>/);
    assert.ok(anchorMatch, "expected an <a href=\"/appointments\"> tag");
    assert.ok(anchorMatch![0].includes("min-h-11"), anchorMatch![0]);
  });
});
