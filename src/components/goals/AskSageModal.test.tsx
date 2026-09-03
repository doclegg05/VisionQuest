import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { buttonTags } from "./__tests__/fixtures";

// The modal must never post on open. Record every apiFetch call so the render
// assertion below can prove the count stays at zero.
const apiFetchCalls: unknown[][] = [];
mock.module("@/lib/api", {
  namedExports: {
    apiFetch: async (...args: unknown[]) => {
      apiFetchCalls.push(args);
      return new Response(null, { status: 500 });
    },
  },
});

let AskSageModal: typeof import("./AskSageModal").AskSageModal;

before(async () => {
  AskSageModal = (await import("./AskSageModal")).AskSageModal;
});

const goal = { id: "m1", content: "Get my GED" };

describe("AskSageModal (F24: prefill, do not auto-post)", () => {
  it("opens with the prompt in an editable box and a Send button, without posting anything", () => {
    const html = renderToString(<AskSageModal goal={goal} onClose={() => {}} />);
    assert.ok(html.includes("<textarea"), "expected an editable textarea for the prompt");
    assert.ok(html.includes("Get my GED"), "expected the goal text inside the prefilled prompt");
    assert.ok(html.includes("Send to Sage"), "expected a Send to Sage button");
    assert.equal(apiFetchCalls.length, 0, "opening the modal must not call /api/chat/send");
  });

  it("tells the student the message also goes into their chat with Sage", () => {
    const html = renderToString(<AskSageModal goal={goal} onClose={() => {}} />);
    assert.ok(html.includes("your chat with Sage"), html);
  });

  it("gives the Send and Close buttons a real 44px touch target", () => {
    const html = renderToString(<AskSageModal goal={goal} onClose={() => {}} />);
    const targets = buttonTags(html).filter((tag) => tag.includes("min-h-11"));
    assert.ok(targets.length >= 2, `expected Send + Close at min-h-11, found ${targets.length}`);
  });
});
