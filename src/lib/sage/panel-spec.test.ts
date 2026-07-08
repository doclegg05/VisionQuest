import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PANEL_SPEC_VERSION,
  STUDENT_PANEL_ROUTES,
  isAllowedPanelRoute,
  parsePanelSpec,
} from "./panel-spec";

const validSpec = {
  version: PANEL_SPEC_VERSION,
  cards: [
    { type: "focus_today", title: "Finish your resume draft", body: "You're one step from a complete portfolio." },
    { type: "encouragement", body: "Three check-ins in a row. Keep the streak alive." },
    {
      type: "next_steps",
      title: "This week",
      steps: [
        { label: "Review your goals", href: "/goals" },
        { label: "Book a session", href: "/appointments" },
      ],
    },
  ],
};

describe("panel-spec: accepts", () => {
  it("parses a well-formed spec", () => {
    const spec = parsePanelSpec(validSpec);
    assert.ok(spec);
    assert.equal(spec.cards.length, 3);
  });

  it("accepts every card type", () => {
    const spec = parsePanelSpec({
      version: 1,
      cards: [
        { type: "focus_today", title: "t", body: "b" },
        { type: "progress_highlight", title: "t", body: "b", metricLabel: "Level", metricValue: "3" },
        { type: "resource_pointer", title: "t", href: "/resources" },
        { type: "encouragement", body: "b" },
      ],
    });
    assert.ok(spec);
  });

  it("derives at least the core student routes from the platform map", () => {
    for (const route of ["/goals", "/appointments", "/resources", "/learning", "/portfolio"]) {
      assert.ok(isAllowedPanelRoute(route), `${route} should be allowed`);
    }
  });
});

describe("panel-spec: rejects (adversarial matrix)", () => {
  const reject = (value: unknown, label: string) =>
    it(label, () => assert.equal(parsePanelSpec(value), null));

  reject(null, "null");
  reject("not json at all", "a bare string");
  reject({ version: 2, cards: validSpec.cards }, "unknown spec version");
  reject({ version: 1, cards: [] }, "zero cards");
  reject(
    { version: 1, cards: Array.from({ length: 5 }, () => ({ type: "encouragement", body: "b" })) },
    "five cards (cap is 4)",
  );
  reject(
    { version: 1, cards: [{ type: "admin_override", title: "t", body: "b" }] },
    "unknown card type",
  );
  reject(
    { version: 1, cards: [{ type: "focus_today", title: "x".repeat(141), body: "b" }] },
    "141-char title",
  );
  reject(
    { version: 1, cards: [{ type: "encouragement", body: "x".repeat(281) }] },
    "281-char body",
  );
  reject(
    { version: 1, cards: [{ type: "resource_pointer", title: "t", href: "https://evil.example.com" }] },
    "external URL href",
  );
  reject(
    { version: 1, cards: [{ type: "resource_pointer", title: "t", href: "javascript:alert(1)" }] },
    "javascript: href",
  );
  reject(
    { version: 1, cards: [{ type: "resource_pointer", title: "t", href: "/teacher" }] },
    "staff-only route href on a student panel",
  );
  reject(
    {
      version: 1,
      cards: [{ type: "next_steps", title: "t", steps: [{ label: "l", href: "/api/admin/ai-provider" }] }],
    },
    "API-route href in next_steps",
  );
  reject(
    { version: 1, cards: [{ type: "focus_today", title: "t", body: "b", taskId: "not-a-cuid" }] },
    "non-cuid taskId",
  );
});

describe("panel-spec: renderer hygiene", () => {
  it("no file under components/dashboard/sage ever uses dangerouslySetInnerHTML", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src", "components", "dashboard", "sage");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      // Match actual USAGE syntax (JSX attribute / object property), so the
      // prose comment in SagePanels.tsx that bans it can't false-positive.
      assert.ok(
        !/dangerouslySetInnerHTML\s*[=:]/.test(source),
        `${file} must not use dangerouslySetInnerHTML`,
      );
    }
  });
});

describe("panel-spec: route allowlist hygiene", () => {
  it("never contains a dynamic segment or staff route", () => {
    for (const route of STUDENT_PANEL_ROUTES) {
      assert.ok(!route.includes("["), `${route} has a dynamic segment`);
      assert.ok(!route.startsWith("/teacher"), `${route} is a teacher route`);
      assert.ok(!route.startsWith("/admin"), `${route} is an admin route`);
      assert.ok(!route.startsWith("/coordinator"), `${route} is a coordinator route`);
    }
  });
});
