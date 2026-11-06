import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import ChatInput from "./ChatInput";
import { SageMiniChat } from "./SageMiniChat";

// Coordinators chat with Sage (owner decision, 2026-11-06) but hold no upload
// or attachment tool, and /api/chat/upload refuses them. Neither chat surface
// may offer them the attach button, and the mini chat must not send them to
// the student /chat page.
const ATTACH_BUTTON = /title="Upload file"/;

describe("chat UI for coordinators", () => {
  it("the composer offers no attach button to the coordinator chat role", () => {
    const html = renderToString(<ChatInput role="coordinator" onSend={() => undefined} />);
    assert.doesNotMatch(html, ATTACH_BUTTON);
  });

  it("the composer still offers the attach button to students and teachers", () => {
    for (const role of ["student", "teacher"] as const) {
      const html = renderToString(<ChatInput role={role} onSend={() => undefined} />);
      assert.match(html, ATTACH_BUTTON, role);
    }
  });

  for (const role of ["coordinator", "program_coordinator"]) {
    it(`the mini chat treats a ${role} as staff`, () => {
      const html = renderToString(<SageMiniChat open role={role} onClose={() => undefined} />);
      assert.doesNotMatch(html, ATTACH_BUTTON);
      assert.doesNotMatch(html, /href="\/chat"/);
    });
  }

  it("the mini chat still offers a student the full chat and the attach button", () => {
    const html = renderToString(<SageMiniChat open role="student" onClose={() => undefined} />);
    assert.match(html, /href="\/chat"/);
    assert.match(html, ATTACH_BUTTON);
  });
});
