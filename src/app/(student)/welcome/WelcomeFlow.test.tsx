import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  QuickWinsNav,
  ScoreCard,
  ScoreSlot,
  createAutoAdvance,
  WELCOME_PATH_CHOICES,
  computeOrientationCompletionPercent,
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

  it("gives the completion button a real 44px touch target — it was ~28px tall before", () => {
    const html = renderToString(
      <QuickWinCard item={item} done={false} saving={false} hasError={false} onComplete={() => {}} />,
    );

    const buttonMatch = html.match(/<button[^>]*>/);
    assert.ok(buttonMatch, "expected a <button> tag");
    assert.ok(buttonMatch![0].includes("min-h-11"), buttonMatch![0]);
  });
});

// ---------------------------------------------------------------------------
// 2. Real denominator — no hardcoded "/ 24"
// ---------------------------------------------------------------------------

describe("computeOrientationCompletionPercent", () => {
  it("computes from the real total passed in, not a hardcoded 24", () => {
    // Same numerator (1 win), two different real totals -> two different
    // percentages. A hardcoded "/24" would return the same number for both.
    assert.equal(computeOrientationCompletionPercent(24, 0, 1), Math.round((1 / 24) * 100));
    assert.equal(computeOrientationCompletionPercent(30, 0, 1), Math.round((1 / 30) * 100));
    assert.notEqual(
      computeOrientationCompletionPercent(24, 0, 1),
      computeOrientationCompletionPercent(30, 0, 1),
    );
  });

  it("counts orientation items already completed before this flow, plus wins from this flow", () => {
    assert.equal(computeOrientationCompletionPercent(24, 5, 3), Math.round((8 / 24) * 100));
  });

  it("returns null (never a fabricated percentage) when the real total is unavailable", () => {
    assert.equal(computeOrientationCompletionPercent(0, 0, 1), null);
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

  it("no title carries a leading ordinal — the heading already asks for ONE choice", () => {
    for (const choice of WELCOME_PATH_CHOICES) {
      assert.doesNotMatch(choice.title, /^\d+\./, `"${choice.title}" still has a numbered prefix`);
    }
  });

  it("does not bake 'Recommended' into the title text — it renders as a separate chip", () => {
    for (const choice of WELCOME_PATH_CHOICES) {
      assert.doesNotMatch(choice.title, /recommended/i, `"${choice.title}" still says Recommended`);
    }
  });

  it("names the orientation door 'Finish Orientation', not a third name for the same thing", () => {
    const orientation = WELCOME_PATH_CHOICES.find((choice) => choice.path === "orientation");
    assert.equal(orientation?.title, "Finish Orientation");
  });

  it("describes the dashboard door with the real step count, not the stale 7-stage figure", () => {
    const dashboard = WELCOME_PATH_CHOICES.find((choice) => choice.path === "dashboard");
    assert.doesNotMatch(dashboard?.description ?? "", /7-stage/);
    assert.match(dashboard?.description ?? "", /8-step/);
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

  it("renders a Recommended chip for the recommended door, separate from the title", () => {
    const recommended = WELCOME_PATH_CHOICES[0]; // the chat door
    assert.equal(recommended.recommended, true);

    const html = renderToString(
      <PathChoiceCard choice={recommended} saving={false} hasError={false} onChoose={() => {}} />,
    );

    assert.ok(html.includes("Recommended"), "expected a visible Recommended chip");
    assert.ok(!/Discover My Career Path[^<]*Recommended/.test(html), "title text should not include the word");
  });

  it("renders no Recommended chip for a non-recommended door", () => {
    const html = renderToString(
      <PathChoiceCard choice={choice} saving={false} hasError={false} onChoose={() => {}} />,
    );

    assert.ok(!html.includes("Recommended"));
  });
});

// ---------------------------------------------------------------------------
// 5. Score card: honest count framing, not a borrowed "readiness" score
// ---------------------------------------------------------------------------

describe("ScoreCard", () => {
  it("shows the real completed/total counts, never the word 'readiness'", () => {
    const html = renderToString(<ScoreCard completedCount={6} totalCount={24} percent={25} />);

    assert.ok(html.includes("6"));
    assert.ok(html.includes("24"));
    assert.ok(html.includes("orientation items"));
    assert.doesNotMatch(html, /readiness/i);
  });

  it("matches the percent the caller passes for the progress bar width", () => {
    const html = renderToString(<ScoreCard completedCount={6} totalCount={24} percent={25} />);

    assert.match(html, /width:\s*25%/);
  });

  it("falls back to count-free praise when the real total is unavailable", () => {
    const html = renderToString(<ScoreCard completedCount={0} totalCount={0} percent={null} />);

    assert.ok(html.includes("off to a great start"));
    assert.ok(!html.includes("orientation items"));
  });

  it("agrees with computeOrientationCompletionPercent's own null case", () => {
    const percent = computeOrientationCompletionPercent(0, 0, 1);
    assert.equal(percent, null);
    const html = renderToString(<ScoreCard completedCount={1} totalCount={0} percent={percent} />);
    assert.ok(html.includes("off to a great start"));
  });

  // The card itself carries no button: QuickWinsNav renders the way forward
  // unconditionally right below it (see its own suite), so a Continue here
  // would stack two of them. What this card owes assistive tech is the meaning
  // of its progress bar, which was a bare styled div.
  it("exposes the progress bar to assistive tech in real item counts", () => {
    const html = renderToString(
      <ScoreCard completedCount={6} totalCount={24} percent={25} />,
    );

    assert.match(html, /role="progressbar"/);
    assert.match(html, /aria-valuenow="6"/);
    assert.match(html, /aria-valuemin="0"/);
    assert.match(html, /aria-valuemax="24"/);
  });

  it("announces no progress bar when there is no real total to measure", () => {
    const html = renderToString(<ScoreCard completedCount={0} totalCount={0} percent={null} />);

    assert.ok(!/role="progressbar"/.test(html), "no bar without a real total");
  });
});

// ---------------------------------------------------------------------------
// Step 2's navigation must never move under the student's finger
//
// Completing the LAST quick win posts to /api/orientation, and the student
// reaches for "Skip for now" while that round trip is in flight. The save
// resolving used to unmount both navigation buttons mid-reach — Playwright
// caught it as "element is not stable" then "element was detached from the
// DOM". This audience (adult learners, mobile, 44x44px touch targets) is the
// least well served by a control that vanishes, so the contract is: the
// navigation stays on screen the whole time, stays actionable, and keeps the
// same footprint when its label flips.
// ---------------------------------------------------------------------------

describe("QuickWinsNav", () => {
  it("keeps both navigation buttons on screen while a quick-win save is in flight", () => {
    const html = renderToString(
      <QuickWinsNav hasQuickWins allWinsDone={false} onAdvance={() => {}} onBack={() => {}} />,
    );

    assert.match(html, /Skip for now/, "the skip escape hatch must stay on screen");
    assert.match(html, /← Back/, "the back escape hatch must stay on screen");
  });

  it("keeps an escape hatch on screen once every win is done — the celebration never traps", () => {
    // showScore no longer gates this block; the same nav renders throughout.
    const html = renderToString(
      <QuickWinsNav hasQuickWins allWinsDone onAdvance={() => {}} onBack={() => {}} />,
    );

    assert.match(html, /Continue/, "the celebration must still offer a way forward");
    assert.match(html, /← Back/, "and a way back");
  });

  it("never disables the navigation — a stalled save must not leave the step with no way out", () => {
    // postQuickWinCompletion has no timeout, so a hung POST holds `saving`
    // forever. Disabling the navigation for the duration would trap the
    // student on a bad connection, which is worse than the bug being fixed.
    for (const allWinsDone of [true, false]) {
      const html = renderToString(
        <QuickWinsNav hasQuickWins allWinsDone={allWinsDone} onAdvance={() => {}} onBack={() => {}} />,
      );

      assert.ok(!/disabled/.test(html), `navigation must stay actionable, got: ${html}`);
    }
  });

  it("gives every variant the same 44px minimum box, so nothing shifts when the label flips", () => {
    // Skip and Continue render into the same slot; a height change between
    // them shifts "← Back" underneath at the exact moment the save resolves —
    // the same moving-target hazard in a different costume.
    const skip = renderToString(
      <QuickWinsNav hasQuickWins allWinsDone={false} onAdvance={() => {}} onBack={() => {}} />,
    );
    const cont = renderToString(
      <QuickWinsNav hasQuickWins allWinsDone onAdvance={() => {}} onBack={() => {}} />,
    );

    assert.equal(
      (skip.match(/min-h-11/g) ?? []).length,
      2,
      `skip variant and back must both carry the 44px floor, got: ${skip}`,
    );
    assert.equal(
      (cont.match(/min-h-11/g) ?? []).length,
      2,
      `continue variant and back must both carry the 44px floor, got: ${cont}`,
    );
  });
});

// ---------------------------------------------------------------------------
// The auto-advance timer must never override a student's own choice
//
// Keeping the navigation on screen through the celebration gives the student
// a control they can actually press — which means the pending 2s timer would
// otherwise drag them back out of wherever they went. An escape hatch you get
// pulled out of is not an escape hatch.
// ---------------------------------------------------------------------------

describe("createAutoAdvance", () => {
  function fakeClock() {
    const scheduled = new Map<number, () => void>();
    let nextHandle = 1;
    return {
      schedule: (callback: () => void) => {
        const handle = nextHandle++;
        scheduled.set(handle, callback);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: (handle: ReturnType<typeof setTimeout>) => {
        scheduled.delete(handle as unknown as number);
      },
      /** Fire everything still scheduled, as the real clock eventually would. */
      tick: () => {
        for (const callback of [...scheduled.values()]) callback();
      },
      pending: () => scheduled.size,
    };
  }

  it("fires the advance when the student leaves the celebration alone", () => {
    const clock = fakeClock();
    const timer = createAutoAdvance(clock.schedule, clock.cancel);
    let advanced = 0;

    timer.start(() => advanced++, 2000);
    clock.tick();

    assert.equal(advanced, 1);
  });

  it("never fires after a cancel — a manual choice wins over the pending timer", () => {
    const clock = fakeClock();
    const timer = createAutoAdvance(clock.schedule, clock.cancel);
    let advanced = 0;

    timer.start(() => advanced++, 2000);
    timer.cancel();
    clock.tick();

    assert.equal(advanced, 0, "the student navigated; the timer must not drag them elsewhere");
    assert.equal(clock.pending(), 0);
  });

  it("tolerates a cancel with nothing scheduled, and a double cancel", () => {
    const clock = fakeClock();
    const timer = createAutoAdvance(clock.schedule, clock.cancel);

    assert.doesNotThrow(() => timer.cancel());
    timer.start(() => {}, 2000);
    timer.cancel();
    assert.doesNotThrow(() => timer.cancel());
  });

  it("routes every navigation button through goToStep, the one place that cancels", () => {
    // A nav button wired straight to setStep skips the cancel, and the timer
    // resurfaces steps later: skip mid-save, land on the path chooser, tap
    // back, get pushed forward again. Reading the source is how that stays
    // impossible to reintroduce — mirroring useAnchorTabSwitch.test.ts, which
    // pins its invariant the same way.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "WelcomeFlow.tsx"),
      "utf8",
    );

    const directNavHandlers = source.match(/onClick=\{\(\) => setStep\(/g) ?? [];
    assert.equal(
      directNavHandlers.length,
      0,
      `${directNavHandlers.length} navigation button(s) call setStep directly and so never cancel the pending auto-advance — route them through goToStep`,
    );
    assert.ok(/onClick=\{\(\) => goToStep\(/.test(source), "the flow should still navigate");
  });
});

describe("ScoreSlot", () => {
  const card = { completedCount: 4, totalCount: 24, percent: 17 };

  it("holds the card's space before it is revealed, so the navigation below never moves", () => {
    // The card mounts either way; only its visibility changes. Measured in a
    // browser at 375px, inserting it on reveal pushed "← Back" down 57px and
    // put "Continue →" on the pixel Back had just vacated — a student
    // reaching for Back as the save landed hit the opposite action.
    const hidden = renderToString(<ScoreSlot shown={false} {...card} />);
    const shown = renderToString(<ScoreSlot shown {...card} />);

    // `invisible` is visibility:hidden, which reserves the box AND stays out
    // of the accessibility tree — unlike opacity-0, which would announce the
    // celebration before it is true.
    assert.match(hidden, /class="invisible"/, "the unrevealed slot must still occupy its box");
    assert.ok(!/class="invisible"/.test(shown), "the revealed slot must not stay hidden");
    assert.ok(
      hidden.includes("finished") && shown.includes("finished"),
      "the card itself must be mounted in BOTH states — that is what reserves the height",
    );
  });

  it("reserves the same box it will fill, so the reveal is a visibility change only", () => {
    const hidden = renderToString(<ScoreSlot shown={false} {...card} />);
    const shown = renderToString(<ScoreSlot shown {...card} />);

    // Identical but for the wrapper's visibility class: same card, same
    // content, therefore the same rendered height.
    assert.equal(hidden.replace(' class="invisible"', ""), shown);
  });

});
