import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket D3 — static source pins for the 44px touch-target floor and the
 * three select-name / link-name / nested-interactive axe fixes that don't
 * have a component test file of their own to extend.
 *
 * This greps rendered-class source text rather than mounting components in
 * a browser: this container cannot run the Playwright collectors
 * (e2e/bench-touch-targets.spec.ts, e2e/bench-axe-authenticated.spec.ts) that
 * are the real measurement (no DATABASE_URL/dev server — standing worktree
 * gotcha). Each assertion here was watched failing against the pre-fix
 * source before the corresponding edit landed.
 */

const ROOT = join(__dirname, "..", "..", "..");

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("D3 touch targets — shared shell (fixes 36x36 + 71x34 on every student route)", () => {
  it("NotificationBell trigger is 44x44 (h-9 w-9 -> h-11 w-11)", () => {
    const src = read("src/components/ui/NotificationBell.tsx");
    assert.ok(
      src.includes("grid h-11 w-11 place-items-center rounded-full"),
      "bell trigger button must be h-11 w-11 (44px)",
    );
    assert.ok(!src.includes("h-9 w-9"), "the old 36px sizing must be gone");
  });

  it("NavBar's mobile Log out button meets the 44px floor", () => {
    const src = read("src/components/ui/NavBar.tsx");
    const match = src.match(/onClick=\{handleLogout\}[\s\S]{0,200}?className="([^"]*)"/);
    assert.ok(match, "could not find the Log out button's className");
    assert.ok(match![1].includes("min-h-11"), `Log out button missing min-h-11: ${match![1]}`);
  });
});

describe("D3 touch targets — /dashboard (42x38 ChatWindow sidebar toggle)", () => {
  it("the conversation-sidebar toggle button meets the 44px floor", () => {
    const src = read("src/components/chat/ChatWindow.tsx");
    const match = src.match(/aria-controls="sage-conversations"[\s\S]{0,200}?className="([^"]*)"/);
    assert.ok(match, "could not find the sidebar toggle button's className");
    assert.ok(match![1].includes("min-h-11"), `sidebar toggle missing min-h-11: ${match![1]}`);
    assert.ok(match![1].includes("min-w-11"), `sidebar toggle missing min-w-11: ${match![1]}`);
  });
});

describe("D3 touch targets — /career", () => {
  it("JobFilters' proximity tabs are covered by JobFilters.test.tsx (beside the component)", () => {
    // See src/components/jobs/JobFilters.test.tsx — the ticket's own
    // convention is to extend a component's existing test file when one
    // exists, rather than duplicate the assertion here.
    assert.ok(true);
  });

  it("JobCard's status select has min-h-11 and an accessible name (touch-target + select-name)", () => {
    const src = read("src/components/jobs/JobCard.tsx");
    const match = src.match(/value=\{draftStatus\}[\s\S]{0,300}?className="([^"]*)"/);
    assert.ok(match, "could not find the status <select>'s className");
    assert.ok(match![1].includes("min-h-11"), `status select missing min-h-11: ${match![1]}`);
    const selectBlock = src.slice(src.indexOf("value={draftStatus}"), src.indexOf("value={draftStatus}") + 400);
    assert.ok(selectBlock.includes('aria-label="Application status"'), "status select missing an accessible name");
  });

  it("JobCard's Update button meets the 44px floor", () => {
    const src = read("src/components/jobs/JobCard.tsx");
    const match = src.match(/persistTracking\(\{ status: draftStatus, notes: draftNotes \}\)[\s\S]{0,200}?className="([^"]*)"/);
    assert.ok(match, "could not find the Update button's className");
    assert.ok(match![1].includes("min-h-11"), `Update button missing min-h-11: ${match![1]}`);
  });
});

describe("D3 touch targets — /appointments (StudentAdvisingHub booking form)", () => {
  it("the advisor select, time-slot select, and title input all meet the 44px floor", () => {
    // The description <textarea> shares the same base class string but was
    // never in the violation list (rows={4} already clears 44px) — match by
    // tag (select/input), not by class string, so it is correctly excluded.
    const src = read("src/components/advising/StudentAdvisingHub.tsx");
    const occurrences = [
      ...src.matchAll(/<(select|input)\b[\s\S]{0,700}?className="((?:min-h-11 )?w-full theme-card-subtle[^"]*)"/g),
    ];
    assert.equal(occurrences.length, 3, "expected exactly 3 booking-form controls (advisor select, slot select, title input)");
    for (const match of occurrences) {
      assert.ok(match[2].includes("min-h-11"), `booking control missing min-h-11: ${match[2]}`);
    }
  });
});

describe("D3 touch targets — /orientation (203x20 download link)", () => {
  it("the welcome-video download link meets the 44px floor", () => {
    const src = read("src/components/orientation/OrientationWelcomeVideo.tsx");
    const match = src.match(/download\s+className="([^"]*)"/);
    assert.ok(match, "could not find the download link's className");
    assert.ok(match![1].includes("min-h-11"), `download link missing min-h-11: ${match![1]}`);
  });
});

describe("D3 touch targets — /goals (220x20 Sage link, 193x38 Add Monthly Goal Card button)", () => {
  it("StudentPathwayPlan's 'Talk to Sage about your goals' link meets the 44px floor", () => {
    const src = read("src/components/goals/StudentPathwayPlan.tsx");
    const match = src.match(/className="(mt-3 inline-flex[^"]*)"/);
    assert.ok(match, "could not find the Sage link's className");
    assert.ok(match![1].includes("min-h-11"), `Sage link missing min-h-11: ${match![1]}`);
  });

  it("GoalsPageClient's 'Add Monthly Goal Card' empty-state button meets the 44px floor", () => {
    const src = read("src/components/goals/GoalsPageClient.tsx");
    const anchor = src.indexOf("onClick={() => setAddingMonthly(true)}");
    assert.ok(anchor > -1, "could not find the Add Monthly Goal Card button's onClick");
    const block = src.slice(anchor, anchor + 400);
    assert.ok(block.includes("Add Monthly Goal Card"), "onClick anchor did not lead to the expected label");
    const classMatch = block.match(/className="([^"]*)"/);
    assert.ok(classMatch, "could not find the button's className");
    assert.ok(classMatch![1].includes("min-h-11"), `Add Monthly Goal Card button missing min-h-11: ${classMatch![1]}`);
  });
});

describe("D3 touch targets — AskSageLink (universal 40px bug: /appointments 223x40, /career 185x40 & 312x40)", () => {
  it("AskSageLink's wrapper is min-h-11 (44px), not the old min-h-10 (40px)", () => {
    const src = read("src/components/sage/AskSageLink.tsx");
    assert.ok(src.includes("min-h-11"), "AskSageLink must use the 44px floor");
    assert.ok(!src.includes("min-h-10"), "the old 40px min-height must be gone");
  });
});

describe("D3 touch targets — /career OpportunitiesHub + EventsHub pill controls", () => {
  it("OpportunitiesHub's Open listing / Attach / View / Remove controls all meet the 44px floor", () => {
    const src = read("src/components/career/OpportunitiesHub.tsx");
    for (const label of ["Open listing", "Attach Current Resume", "View Resume", "Remove Resume"]) {
      const idx = src.indexOf(label);
      assert.ok(idx > -1, `could not find "${label}" in OpportunitiesHub.tsx`);
      // The className attribute sits before the label text in each of these
      // elements; look back a bounded window and take the LAST className in
      // it (the one on the element that actually wraps this label).
      const windowStart = Math.max(0, idx - 700);
      const block = src.slice(windowStart, idx);
      const classMatches = [...block.matchAll(/className="([^"]*)"/g)];
      const nearest = classMatches.at(-1);
      assert.ok(nearest, `could not find a className preceding "${label}"`);
      assert.ok(nearest![1].includes("min-h-11"), `"${label}" control missing min-h-11: ${nearest![1]}`);
    }
  });

  it("OpportunitiesHub's application-status select is 44px tall and has an accessible name (CI residual: 9x 304x39 + select-name)", () => {
    const src = read("src/components/career/OpportunitiesHub.tsx");
    const idx = src.indexOf("APPLICATION_STATUSES.map");
    assert.ok(idx > -1, "could not find the status select in OpportunitiesHub.tsx");
    const block = src.slice(Math.max(0, idx - 900), idx);
    const nearest = [...block.matchAll(/className="([^"]*)"/g)].at(-1);
    assert.ok(nearest, "could not find the select's className");
    assert.ok(nearest![1].includes("min-h-11"), `status select missing min-h-11: ${nearest![1]}`);
    assert.ok(/aria-label="Application status"/.test(block), "status select missing aria-label");
  });

  it("EventsHub's Open link / registration toggle controls meet the 44px floor", () => {
    const src = read("src/components/career/EventsHub.tsx");
    const openLinkMatch = src.match(/className="([^"]*)"\s*>\s*Open link/);
    assert.ok(openLinkMatch, "could not find the Open link anchor's className");
    assert.ok(openLinkMatch![1].includes("min-h-11"), `Open link missing min-h-11: ${openLinkMatch![1]}`);

    const registerMatch = src.match(/className=\{`(min-h-11 )?rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60/);
    assert.ok(registerMatch, "could not find the registration toggle button's className");
    assert.ok(registerMatch![1], "registration toggle button missing min-h-11");
  });
});

describe("D3 touch targets — /settings (6x 20x20 checkbox/radio inputs)", () => {
  it("the SMS consent checkbox is sr-only with a peer-styled visual indicator", () => {
    const src = read("src/components/settings/SettingsView.tsx");
    // The collector measures the raw <input>'s own bounding box; a taller
    // wrapping <label> alone does not clear a violation for a checkbox/radio.
    // sr-only makes the real input a 1x1 clipped box, which the collector's
    // own exclusion already treats as "not a touch target a sighted user
    // could tap" — the surrounding <label> (already min-h-11) is the real
    // tap area, and a peer-styled sibling span carries the visible state.
    assert.ok(src.includes('type="checkbox"'), "consent checkbox must still exist");
    const checkboxBlock = src.slice(src.indexOf('type="checkbox"') - 50, src.indexOf('type="checkbox"') + 300);
    assert.ok(checkboxBlock.includes("peer sr-only"), "consent checkbox must be sr-only + peer");
    assert.ok(src.includes("peer-checked:bg-[var(--accent-strong)]"), "must render a checked-state visual indicator");
  });

  it("the 5 work-transport radios are sr-only with a peer-styled visual indicator", () => {
    const src = read("src/components/settings/WorkAvailabilitySection.tsx");
    const matches = [...src.matchAll(/type="radio"[\s\S]{0,250}?className="([^"]*)"/g)];
    assert.equal(matches.length, 1, "expected one radio <input> template (mapped over TRANSPORT_MODES)");
    assert.ok(matches[0][1].includes("peer sr-only"), `transport radio must be sr-only + peer: ${matches[0][1]}`);
    assert.ok(src.includes("peer-checked:border-[var(--accent-strong)]"), "must render a checked-state visual indicator");
  });
});

describe("D3 axe-authenticated — select-name", () => {
  it("OperationsTab's case-notes category select has an accessible name", () => {
    const src = read("src/components/teacher/student-detail/OperationsTab.tsx");
    const idx = src.indexOf("noteForm.category");
    assert.ok(idx > -1, "could not find the case-notes category select");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('aria-label="Note category"'), "case-notes select missing an accessible name");
  });
});

describe("D3 axe-authenticated — link-name", () => {
  it("InterventionQueuePanel's icon-only avatar Link has an accessible name", () => {
    const src = read("src/components/teacher/InterventionQueuePanel.tsx");
    const idx = src.indexOf("Avatar placeholder");
    assert.ok(idx > -1, "could not find the avatar Link block");
    const block = src.slice(idx, idx + 300);
    assert.ok(/aria-label=\{`Open \$\{student\.name\}/.test(block), "avatar Link missing an accessible name");
  });
});

describe("D3 axe-authenticated — nested-interactive", () => {
  it("InterventionQueue's StudentAccordion no longer nests a button/Link inside its toggle button", () => {
    const src = read("src/components/teacher/InterventionQueue.tsx");
    // The toggle button's own className changed from the old row-wrapping
    // shape to one that wraps only the chevron + name column; the quick
    // actions (Ask Sage button, View student Link) moved to a sibling <div>
    // after the toggle button's closing tag, not before it.
    assert.ok(
      src.includes('className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left'),
      "toggle button must wrap only the chevron+name column now",
    );
    const toggleButtonStart = src.indexOf("onClick={onToggle}");
    const toggleButtonClose = src.indexOf("</button>", toggleButtonStart);
    const toggleButtonBody = src.slice(toggleButtonStart, toggleButtonClose);
    assert.ok(!toggleButtonBody.includes("Ask Sage"), "the toggle button must not contain the Ask Sage button");
    assert.ok(!toggleButtonBody.includes("View student"), "the toggle button must not contain the View student link");
    // And the quick actions must still exist, just outside it.
    const afterToggle = src.slice(toggleButtonClose);
    assert.ok(afterToggle.includes("Ask Sage"), "the Ask Sage button must still render, as a sibling");
    assert.ok(afterToggle.includes("View student"), "the View student link must still render, as a sibling");
  });
});

describe("D3 axe-authenticated — color-contrast (light-theme tokens)", () => {
  it("--ink-faint clears 4.5:1 (was rgba(0,0,0,0.25), measured 1.83:1)", () => {
    const css = read("src/app/globals.css");
    assert.ok(css.includes("--ink-faint: rgba(0, 0, 0, 0.55);"), "light-theme --ink-faint must be darkened to 0.55 alpha");
    assert.ok(!css.match(/--ink-faint: rgba\(0, 0, 0, 0\.25\);/), "the old 0.25-alpha (1.83:1) value must be gone");
  });

  it("--badge-warning-text / --urgency-high-text / --toast-celebration-text clear 4.5:1 (were #8a6d05, measured 4.34:1)", () => {
    const css = read("src/app/globals.css");
    assert.ok(css.includes("--badge-warning-text: #7a5f04;"));
    assert.ok(css.includes("--urgency-high-text: #7a5f04;"));
    assert.ok(css.includes("--toast-celebration-text: #7a5f04;"));
    // The old value is still named in explanatory comments (":root" section
    // only — dark theme's own #8a6d06-adjacent values are untouched and
    // fine); check the actual DECLARATION line is gone, not the whole file.
    assert.ok(!css.includes(": #8a6d05;"), "the old failing hex must be gone as a declared value");
  });

  it("--program-ietp-text clears 4.5:1 (was #c2410c, measured 4.47:1)", () => {
    const css = read("src/app/globals.css");
    assert.ok(css.includes("--program-ietp-text: #a53509;"));
    assert.ok(!css.includes(": #c2410c;"), "the old just-failing hex must be gone as a declared value");
  });
});
