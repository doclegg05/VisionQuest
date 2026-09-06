import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SUBSIDY_RULES,
  SUBSIDY_RULE_KEYS,
  formatSubsidyLine,
  verifiedSubsidyRules,
  type SubsidyRule,
} from "./subsidies-shared";

describe("the WV Works subsidy rule table", () => {
  it("covers the five levers the plan's P0.8 sign-off names", () => {
    assert.deepEqual([...SUBSIDY_RULE_KEYS], ["eip", "esp", "ojt", "wotc", "bonding"]);
    for (const key of SUBSIDY_RULE_KEYS) {
      assert.ok(SUBSIDY_RULES[key], `no rule for ${key}`);
    }
  });

  it("ships every figure UNVERIFIED, with a source URL", () => {
    // This is the load-bearing property. A dollar figure on an employer-facing
    // page that nobody at the local WV Works office has confirmed is exactly
    // what P0.8 exists to prevent, so the table's shipped state is "known to
    // us, not yet confirmed" — and `verifiedAt: null` is what keeps it off
    // the page until somebody sets it.
    for (const key of SUBSIDY_RULE_KEYS) {
      const rule: SubsidyRule = SUBSIDY_RULES[key];
      assert.equal(rule.verifiedAt, null, `${key} must ship unverified`);
      assert.ok(rule.source.startsWith("https://"), `${key} has no source URL`);
      assert.ok(rule.figures.length > 0, `${key} states no figures`);
      for (const figure of rule.figures) {
        assert.equal(figure.verifiedAt, null, `${key}: figure "${figure.label}" is pre-verified`);
      }
    }
    assert.deepEqual(verifiedSubsidyRules(), [], "nothing is verified until an owner says so");
  });

  it("says who triggers each one, because the employer cannot", () => {
    // EIP and ESP are referred by the student's WV Works case manager, not by
    // the employer and not by SPOKES. A line that implied otherwise would send
    // an employer to the wrong office.
    assert.match(SUBSIDY_RULES.eip.summary, /case manager/i);
    assert.match(SUBSIDY_RULES.esp.summary, /referral|case manager/i);
    assert.match(SUBSIDY_RULES.ojt.summary, /workforce development board|WDB/i);
  });

  it("renders nothing at all for an unverified rule", () => {
    assert.equal(formatSubsidyLine(SUBSIDY_RULES.eip), null);
  });

  it("renders a line only once a rule carries a verifiedAt date", () => {
    const verified: SubsidyRule = {
      ...SUBSIDY_RULES.eip,
      verifiedAt: "2026-10-01",
      figures: SUBSIDY_RULES.eip.figures.map((figure) => ({
        ...figure,
        verifiedAt: "2026-10-01",
      })),
    };
    const line = formatSubsidyLine(verified);
    assert.ok(line, "a verified rule must produce a line");
    assert.match(line, /Employment Incentive/i);
    assert.match(line, /check with|ask/i, "every benefits line points at a human");
  });

  it("refuses to render a rule verified at the top level but not on its figures", () => {
    // Half-verified is the dangerous state: a date on the rule and none on the
    // number it quotes would put an unconfirmed figure in front of an employer
    // under a "confirmed" banner.
    const half: SubsidyRule = { ...SUBSIDY_RULES.wotc, verifiedAt: "2026-10-01" };
    assert.equal(formatSubsidyLine(half), null);
  });
});
