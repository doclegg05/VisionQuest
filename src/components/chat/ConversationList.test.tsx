import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import type { ConversationSummary } from "@/types";
import { ConversationListItem } from "./ConversationList";

const conv: ConversationSummary = {
  id: "c1",
  module: "sage",
  stage: "monthly",
  title: "Plan my GED month",
  active: true,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const html = renderToString(
  <ConversationListItem conv={conv} isActive={false} isDeleting={false} onSelect={() => {}} onDelete={() => {}} />,
);
const deleteTag = (html.match(/<button\b[^>]*>/g) ?? []).find((tag) => tag.includes("Delete conversation"));

describe("ConversationListItem delete control (F45: reachable on touch)", () => {
  it("renders the delete button", () => {
    assert.ok(deleteTag, "expected a Delete conversation button");
    assert.ok(deleteTag!.includes('aria-label="Delete conversation &quot;Plan my GED month&quot;"'), deleteTag);
  });

  it("is visible without hover", () => {
    assert.ok(!deleteTag!.includes("opacity-0"), deleteTag);
  });

  it("has a real 44px touch target", () => {
    assert.ok(deleteTag!.includes("min-h-11"), deleteTag);
    assert.ok(deleteTag!.includes("min-w-11"), deleteTag);
  });
});
