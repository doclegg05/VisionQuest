import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import * as authPage from "./AuthPageClient";
import AuthPageClient from "./AuthPageClient";
import { LOGIN_FIELD_LABEL } from "./login-label";

function withAppRouter(node: React.ReactNode) {
  const router = {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
  return (
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      {node}
    </AppRouterContext.Provider>
  );
}

function render(props: { googleAuthEnabled: boolean; demoEnabled: boolean }) {
  return renderToString(withAppRouter(<AuthPageClient {...props} />));
}

/** The class list of the first `<section>` whose class list contains `marker`. */
function sectionClasses(html: string, marker: string): string[] {
  const tags = html.match(/<section\b[^>]*>/g) ?? [];
  const tag = tags.find((t) => new RegExp(`class="[^"]*\\b${marker}\\b`).test(t));
  assert.ok(tag, `expected a <section> with the class ${marker}`);
  const classes = /class="([^"]*)"/.exec(tag)?.[1] ?? "";
  return classes.split(/\s+/).filter(Boolean);
}

/**
 * Where a grid item sits in the visual order at one width. Mobile first: the
 * bare `order-N` class applies below `lg`, and `lg:order-N` takes over from
 * `lg` up. No order class means the item keeps its place in the page source.
 */
function visualOrder(classes: string[], width: "base" | "lg"): number {
  const pattern = width === "lg" ? /^lg:order-(\d+)$/ : /^order-(\d+)$/;
  const found = classes.map((c) => pattern.exec(c)).find(Boolean);
  if (found) return Number(found[1]);
  if (width === "lg") return visualOrder(classes, "base");
  return 0;
}

const HERO_MARKER = "auth-hero-panel";
const FORM_MARKER = "panel-strong";
const GOOGLE_OFF_NOTE = "Google sign-in is not enabled in this environment.";

describe("AuthPageClient layout order", () => {
  for (const demoEnabled of [false, true]) {
    describe(`with the demo ${demoEnabled ? "on" : "off"}`, () => {
      const html = render({ googleAuthEnabled: true, demoEnabled });
      const hero = sectionClasses(html, HERO_MARKER);
      const form = sectionClasses(html, FORM_MARKER);

      it("puts the sign-in form above the hero below the lg breakpoint", () => {
        assert.ok(
          visualOrder(form, "base") < visualOrder(hero, "base"),
          `expected the form first on phones; form classes: ${form.join(" ")}; hero classes: ${hero.join(" ")}`,
        );
      });

      it("keeps the hero on the left and the form on the right from lg up", () => {
        assert.ok(
          visualOrder(hero, "lg") < visualOrder(form, "lg"),
          `expected the hero first on desktop; hero classes: ${hero.join(" ")}; form classes: ${form.join(" ")}`,
        );
      });

      it("keeps the two-column grid on lg", () => {
        assert.ok(html.includes("lg:grid-cols-[1.15fr_0.85fr]"));
      });

      it("still shows the sign-in form", () => {
        assert.ok(html.includes('aria-label="Sign in"'));
      });
    });
  }

  it("keeps both demo buttons visible when the demo is on", () => {
    const html = render({ googleAuthEnabled: false, demoEnabled: true });
    assert.ok(html.includes(">Explore as a student</button>"));
    assert.ok(html.includes(">Explore as an instructor</button>"));
  });
});

describe("AuthPageClient with Google sign-in off", () => {
  for (const demoEnabled of [false, true]) {
    it(`shows no developer note (demo ${demoEnabled ? "on" : "off"})`, () => {
      const html = render({ googleAuthEnabled: false, demoEnabled });
      assert.ok(!html.includes(GOOGLE_OFF_NOTE));
      assert.ok(!html.includes("in this environment"));
      assert.ok(!html.includes("Sign in with Google"));
    });
  }

  it("leaves no empty box behind in place of the note", () => {
    const off = render({ googleAuthEnabled: false, demoEnabled: false });
    const on = render({ googleAuthEnabled: true, demoEnabled: false });
    // With Google off the page has no "or" divider and no extra muted box
    // beyond the one instructor note.
    assert.ok(!off.includes(">or</span>"));
    assert.ok(on.includes(">or</span>"));
    const mutedBoxes = (html: string) => html.split("bg-[var(--surface-muted)]").length - 1;
    assert.equal(mutedBoxes(off), mutedBoxes(on));
  });
});

describe("AuthPageClient login field label", () => {
  it("uses the shared label, which stays exactly 'Username or Email'", () => {
    const html = render({ googleAuthEnabled: true, demoEnabled: false });
    assert.equal(LOGIN_FIELD_LABEL, "Username or Email");
    assert.match(html, new RegExp(`<label for="studentId"[^>]*>${LOGIN_FIELD_LABEL}</label>`));
  });
});

describe("AuthErrorLine", () => {
  const SERVER_MESSAGE =
    "We could not sign you in. Check your username or email and your password, then try again. After too many tries, wait 15 minutes or ask your instructor for help.";

  function renderError(message: string): string {
    const Component = (authPage as Record<string, unknown>).AuthErrorLine as
      | React.ComponentType<{ message: string }>
      | undefined;
    assert.ok(Component, "expected AuthPageClient to export AuthErrorLine");
    return renderToString(createElement(Component, { message }));
  }

  it("announces the message to a screen reader", () => {
    const html = renderError(SERVER_MESSAGE);
    assert.match(html, /<p role="alert"/);
    assert.ok(html.includes(SERVER_MESSAGE));
  });

  it("wraps long text instead of running off a 375px screen", () => {
    const html = renderError(SERVER_MESSAGE);
    assert.match(html, /<span class="[^"]*\bmin-w-0\b[^"]*\bbreak-words\b[^"]*"/);
  });

  it("keeps the warning icon from shrinking next to a long message", () => {
    const html = renderError(SERVER_MESSAGE);
    assert.match(html, /<svg[^>]*class="[^"]*\bshrink-0\b/);
  });
});
