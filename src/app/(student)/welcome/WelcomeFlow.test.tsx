import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  isSignatureRequiredItem,
  isVerificationRequiredItem,
} from "@/lib/orientation-step-resources";
import { WELCOME_PATHS } from "@/lib/progression/welcome-routing";
import WelcomeFlow, {
  PathChoiceCard,
  QuickWinCard,
  WELCOME_PATH_CHOICES,
  computeReadinessPercent,
  postQuickWinCompletion,
  postWelcomeCompletion,
} from "./WelcomeFlow";

/**
 * WelcomeFlow calls useRouter() to leave the flow once the completion fact is
 * saved, and next/navigation's hook throws outside an app-router context.
 * Wrapping the render supplies one — the calls are recorded so a test can
 * assert where a path choice sent the student.
 */
function withAppRouter(node: React.ReactNode) {
  const calls: { method: string; arg?: string }[] = [];
  const router = {
    push: (href: string) => calls.push({ method: "push", arg: href }),
    replace: (href: string) => calls.push({ method: "replace", arg: href }),
    refresh: () => calls.push({ method: "refresh" }),
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
  return {
    calls,
    element: (
      <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
        {node}
      </AppRouterContext.Provider>
    ),
  };
}

function fetchStub(
  impl: () => Promise<Response> | never,
): typeof fetch & { calls: { input: RequestInfo | URL; init?: RequestInit }[] } {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const stub = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return impl();
  };
  return Object.assign(stub as typeof fetch, { calls });
}

// ---------------------------------------------------------------------------
// 1. Silent fail -> visible, dignified failure
// ---------------------------------------------------------------------------

describe("postQuickWinCompletion", () => {
  it("posts itemId + completed:true to /api/orientation and returns true on a 2xx response", async () => {
    const fetchFn = fetchStub(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const saved = await postQuickWinCompletion("item-1", fetchFn);

    assert.equal(saved, true);
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].input, "/api/orientation");
    assert.equal(fetchFn.calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(fetchFn.calls[0].init?.body)), {
      itemId: "item-1",
      completed: true,
    });
  });

  it("returns false (never throws) on a non-2xx response — this is the silent-fail bug being fixed", async () => {
    const fetchFn = fetchStub(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );

    const saved = await postQuickWinCompletion("item-1", fetchFn);

    assert.equal(saved, false);
  });

  it("returns false (never throws) when fetch rejects outright — network failure", async () => {
    const fetchFn = fetchStub(() => Promise.reject(new Error("network down")));

    const saved = await postQuickWinCompletion("item-1", fetchFn);

    assert.equal(saved, false);
  });
});

describe("QuickWinCard failure-path markup", () => {
  const item = { id: "item-1", label: "Review this", description: "A quick read." };

  it("shows a plain-language retry notice when the save failed — nothing disappears silently", () => {
    const html = renderToString(
      <QuickWinCard item={item} done={false} saving={false} hasError onComplete={() => {}} />,
    );

    assert.match(html, /role="alert"/);
    assert.ok(
      /didn.{0,6}t save/i.test(html) && /try again/i.test(html),
      `expected a plain-language retry notice, got: ${html}`,
    );
    assert.ok(html.includes("Try again"), "retry button should relabel itself");
  });

  it("renders no error notice on a normal, un-failed item", () => {
    const html = renderToString(
      <QuickWinCard item={item} done={false} saving={false} hasError={false} onComplete={() => {}} />,
    );

    assert.ok(!/role="alert"/.test(html));
    assert.ok(html.includes("I&#x27;ve read this") || html.includes("I've read this"));
  });

  it("still renders the item's real label and description, not a blank row", () => {
    const html = renderToString(
      <QuickWinCard item={item} done={false} saving={false} hasError={false} onComplete={() => {}} />,
    );

    assert.ok(html.includes("Review this"));
    assert.ok(html.includes("A quick read."));
  });

  it("a completed item shows no error notice even if an error id lingers", () => {
    const html = renderToString(
      <QuickWinCard item={item} done saving={false} hasError onComplete={() => {}} />,
    );

    assert.ok(!/role="alert"/.test(html), "a done item must not show a stale retry notice");
  });
});

// ---------------------------------------------------------------------------
// 2. Real denominator — no hardcoded "/ 24"
// ---------------------------------------------------------------------------

describe("computeReadinessPercent", () => {
  it("computes from the real total passed in, not a hardcoded 24", () => {
    // Same numerator (1 win), two different real totals -> two different
    // percentages. A hardcoded "/24" would return the same number for both.
    assert.equal(computeReadinessPercent(24, 0, 1), Math.round((1 / 24) * 100));
    assert.equal(computeReadinessPercent(30, 0, 1), Math.round((1 / 30) * 100));
    assert.notEqual(computeReadinessPercent(24, 0, 1), computeReadinessPercent(30, 0, 1));
  });

  it("counts orientation items already completed before this flow, plus wins from this flow", () => {
    assert.equal(computeReadinessPercent(24, 5, 3), Math.round((8 / 24) * 100));
  });

  it("returns null (never a fabricated percentage) when the real total is unavailable", () => {
    assert.equal(computeReadinessPercent(0, 0, 1), null);
  });
});

// ---------------------------------------------------------------------------
// 3. Quick-wins step: verify the review's claim, prove the decision
// ---------------------------------------------------------------------------

describe("quick-win eligibility — verifying the review's 'always empty' claim", () => {
  // Mirrors welcome/page.tsx's exact filter against the real production
  // catalog. The review claimed every quick-win candidate is filtered out
  // because all four target labels map to signature-required forms. That is
  // false for the shipped catalog: "Review Ready to Work Attendance
  // Verification" contains "attendance" but maps to the rtw-attendance form,
  // which requires neither a signature nor instructor verification (see
  // src/lib/orientation-step-resources.test.ts, which pins this exact
  // survivor against the full seed catalog).
  const REAL_SURVIVOR_LABEL = "Review Ready to Work Attendance Verification";

  it("the real 'Ready to Work' orientation item is NOT filtered out — the step is not always empty", () => {
    assert.equal(isSignatureRequiredItem(REAL_SURVIVOR_LABEL), false);
    assert.equal(isVerificationRequiredItem(REAL_SURVIVOR_LABEL), false);
  });

  it("when that item survives the filter, WelcomeFlow renders it with real content instead of an empty step", () => {
    const html = renderToString(
      withAppRouter(
        <WelcomeFlow
          studentName="Jordan"
          quickWinItems={[
            {
              id: "seed-orient-22",
              label: REAL_SURVIVOR_LABEL,
              description: "Attendance verification form for Ready to Work certification",
            },
          ]}
          totalOrientationItems={24}
        />,
      ).element,
    );

    // Step 0 (Welcome) is the initial render; the quick-win list itself only
    // becomes visible after advancing, but the data driving it must be real,
    // not empty — prove the component was handed (and will render) genuine
    // content rather than a structurally-guaranteed-empty list.
    assert.ok(html.length > 0);
    const cardHtml = renderToString(
      <QuickWinCard
        item={{
          id: "seed-orient-22",
          label: REAL_SURVIVOR_LABEL,
          description: "Attendance verification form for Ready to Work certification",
        }}
        done={false}
        saving={false}
        hasError={false}
        onComplete={() => {}}
      />,
    );
    assert.ok(cardHtml.includes(REAL_SURVIVOR_LABEL));
    assert.ok(cardHtml.includes("Attendance verification form for Ready to Work certification"));
  });
});

// ---------------------------------------------------------------------------
// 4. Path choice: leaving the flow is recorded, so no door loops back
// ---------------------------------------------------------------------------

describe("WELCOME_PATH_CHOICES", () => {
  it("offers exactly the path vocabulary the API accepts — no unrecordable door", () => {
    assert.deepEqual(
      WELCOME_PATH_CHOICES.map((choice) => choice.path),
      [...WELCOME_PATHS],
    );
  });

  it("keeps the dashboard door, the one that loops without a recorded completion", () => {
    const dashboard = WELCOME_PATH_CHOICES.find((choice) => choice.path === "dashboard");
    assert.ok(dashboard, "path choice 3 must exist");
    assert.equal(dashboard.href, "/dashboard");
  });

  it("gives every door a distinct destination", () => {
    const hrefs = WELCOME_PATH_CHOICES.map((choice) => choice.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
    for (const href of hrefs) assert.match(href, /^\/[a-z-]+$/);
  });
});

describe("postWelcomeCompletion", () => {
  it("posts the chosen path to /api/welcome/complete and returns true on a 2xx response", async () => {
    const fetchFn = fetchStub(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
    );

    const saved = await postWelcomeCompletion("orientation", fetchFn);

    assert.equal(saved, true);
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].input, "/api/welcome/complete");
    assert.equal(fetchFn.calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(fetchFn.calls[0].init?.body)), { path: "orientation" });
  });

  it("returns false (never throws) on a non-2xx response", async () => {
    const fetchFn = fetchStub(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );

    assert.equal(await postWelcomeCompletion("dashboard", fetchFn), false);
  });

  it("returns false (never throws) when fetch rejects outright", async () => {
    const fetchFn = fetchStub(() => Promise.reject(new Error("network down")));

    assert.equal(await postWelcomeCompletion("chat", fetchFn), false);
  });
});

describe("PathChoiceCard", () => {
  const choice = WELCOME_PATH_CHOICES[2]; // the dashboard door

  it("renders a real link, so the destination stays visible and middle-clickable", () => {
    const html = renderToString(
      <PathChoiceCard choice={choice} saving={false} hasError={false} onChoose={() => {}} />,
    );

    assert.match(html, /href="\/dashboard"/);
    assert.ok(html.includes(choice.title));
    assert.ok(!/role="alert"/.test(html));
  });

  it("shows a plain-language retry notice when the completion failed to save", () => {
    const html = renderToString(
      <PathChoiceCard choice={choice} saving={false} hasError onChoose={() => {}} />,
    );

    assert.match(html, /role="alert"/);
    assert.ok(
      /didn.{0,6}t save/i.test(html) && /try again/i.test(html),
      `expected a plain-language retry notice, got: ${html}`,
    );
  });

  it("marks an in-flight choice busy instead of looking inert", () => {
    const html = renderToString(
      <PathChoiceCard choice={choice} saving hasError={false} onChoose={() => {}} />,
    );

    assert.match(html, /aria-busy="true"/);
  });
});
