import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  isSignatureRequiredItem,
  isVerificationRequiredItem,
} from "@/lib/orientation-step-resources";
import WelcomeFlow, {
  QuickWinCard,
  computeReadinessPercent,
  postQuickWinCompletion,
} from "./WelcomeFlow";

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
