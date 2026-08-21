import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { SageMemoryList } from "./SageMemoryList";

describe("SageMemoryList", () => {
  it("shows a dignified empty state when there are no memories", () => {
    const html = renderToString(<SageMemoryList memories={[]} />);
    assert.ok(html.includes("Sage has not written any notes about you yet."));
    assert.ok(html.includes("Keep chatting with Sage"));
  });

  it("groups memories by category with a plain-language heading", () => {
    const html = renderToString(
      <SageMemoryList
        memories={[
          {
            id: "mem-1",
            content: "Wants to finish a CDL program by spring.",
            category: "goal",
            sourceType: "conversation",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "mem-2",
            content: "Prefers morning classes.",
            category: "preference",
            sourceType: "manual",
            createdAt: "2026-07-15T00:00:00.000Z",
          },
        ]}
      />,
    );

    assert.ok(html.includes("Your goals"), "expected the goal-category heading");
    assert.ok(html.includes("Things you like"), "expected the preference-category heading");
    assert.ok(html.includes("Wants to finish a CDL program by spring."));
    assert.ok(html.includes("Prefers morning classes."));
  });

  it("shows a plain-language source label and a formatted date for each note", () => {
    const html = renderToString(
      <SageMemoryList
        memories={[
          {
            id: "mem-1",
            content: "Wants to finish a CDL program by spring.",
            category: "goal",
            sourceType: "conversation",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    assert.ok(html.includes("From a chat with Sage"));
    // Computed the same way the component formats it, rather than a
    // hardcoded string — a fixed UTC timestamp renders as a different
    // calendar day depending on the machine's local timezone (e.g. EDT
    // renders 2026-08-01T00:00:00Z as "Jul 31, 2026", not "Aug 1, 2026").
    const expectedDate = new Date("2026-08-01T00:00:00.000Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    assert.ok(html.includes(expectedDate));
  });

  it("puts memories with an unrecognized category into the Other notes group instead of dropping them", () => {
    const html = renderToString(
      <SageMemoryList
        memories={[
          {
            id: "mem-1",
            content: "Some future category the client does not know about yet.",
            category: "totally-new-category",
            sourceType: "operation",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    assert.ok(html.includes("Other notes"));
    assert.ok(html.includes("Some future category the client does not know about yet."));
  });

  it("never renders an edit or delete control — correction is teacher-mediated, not self-service", () => {
    const html = renderToString(
      <SageMemoryList
        memories={[
          {
            id: "mem-1",
            content: "Wants to finish a CDL program by spring.",
            category: "goal",
            sourceType: "conversation",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    assert.ok(!/<button/i.test(html), "expected no interactive edit/delete buttons in the list itself");
  });
});
