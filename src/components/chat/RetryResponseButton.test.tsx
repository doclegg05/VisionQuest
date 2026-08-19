import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { RetryResponseButton } from "./RetryResponseButton";

describe("RetryResponseButton", () => {
  it("renders a labeled button that can re-send the failed message", () => {
    const html = renderToString(<RetryResponseButton onRetry={() => {}} />);
    assert.ok(html.includes("Retry response"));
    assert.ok(html.includes("<button"));
  });
});
