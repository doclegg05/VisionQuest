import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getSloBarMs } from "../../scripts/sage-usage-summary.mjs";

/**
 * SLO bar resolution against config/sage-slo.json.
 *
 * `LlmCallLog.model` used to hold the provider CLASS — literally "gemini" or
 * "ollama" — which happened to match this config's keys exactly. It now holds
 * the real model tag so that per-role models are distinguishable in the
 * ledger, and that quietly broke the lookup in BOTH directions: sage_chat's
 * cloud bar is 6000ms against a 45000ms default (7.5x too loose — the 3x
 * regression detector stops firing), and its local bar is 90000ms (2x too
 * tight — ordinary 20-70s local turns start reporting as breaches).
 *
 * These tests pin the resolution order and, just as importantly, that an
 * unmapped model is REPORTED rather than silently checked against the default.
 */

const sloConfig = JSON.parse(readFileSync("config/sage-slo.json", "utf8"));

describe("getSloBarMs", () => {
  it("maps a real Gemini model tag back to the cloud chat bar", () => {
    const bar = getSloBarMs("sage_chat", "gemini-3.1-flash-lite", sloConfig);
    assert.equal(bar.barMs, 6000);
    assert.equal(bar.source, "provider");
  });

  it("maps a real Ollama model tag back to the local chat bar", () => {
    const bar = getSloBarMs("sage_chat", "gemma4:26b", sloConfig);
    assert.equal(bar.barMs, 90000);
    assert.equal(bar.source, "provider");
  });

  it("maps every per-role candidate model this repo names", () => {
    // The bake-off slate in docs/plans/2026-08-21-local-ai-role-models.md. A
    // candidate that wins a role and then has no bar would be checked against
    // a default 2x tighter than the local path actually runs.
    for (const tag of ["gemma4:12b-mlx", "gemma4:e4b-mlx", "gemma4:26b-a4b-it-qat"]) {
      const bar = getSloBarMs("sage_chat", tag, sloConfig);
      assert.equal(bar.barMs, 90000, `${tag} did not resolve to the local chat bar`);
      assert.notEqual(bar.source, "default");
    }
  });

  it("still honors the bare provider keys the config is written in", () => {
    assert.equal(getSloBarMs("sage_chat", "gemini", sloConfig).barMs, 6000);
    assert.equal(getSloBarMs("sage_chat", "ollama", sloConfig).barMs, 90000);
  });

  it("lets an exact model entry beat its provider bucket", () => {
    // This is the point of per-role models: a small extraction model should be
    // holdable to a tighter bar than the big chat model.
    const withModelBar = {
      ...sloConfig,
      perProviderP95Ms: {
        sage_chat: { ...sloConfig.perProviderP95Ms.sage_chat, "gemma4:e4b": 15000 },
      },
    };
    const bar = getSloBarMs("sage_chat", "gemma4:e4b", withModelBar);
    assert.equal(bar.barMs, 15000);
    assert.equal(bar.source, "model");
  });

  it("flags an unmapped model on a callSite that has bars", () => {
    const bar = getSloBarMs("sage_chat", "some-future-model:70b", sloConfig);
    assert.equal(bar.barMs, sloConfig.defaultP95Ms);
    assert.equal(bar.source, "default");
    assert.equal(bar.unmapped, true, "an unmapped chat model must be reported, not swallowed");
  });

  it("does NOT flag a background callSite, which has always used the default", () => {
    const bar = getSloBarMs("sage_post.goals", "gemma4:e4b", sloConfig);
    assert.equal(bar.barMs, sloConfig.defaultP95Ms);
    assert.equal(bar.source, "default");
    assert.equal(
      bar.unmapped,
      false,
      "warning on every background row would train the operator to ignore the warning",
    );
  });
});

describe("config/sage-slo.json", () => {
  it("maps every tag to a provider that actually has a bar", () => {
    const chatBars = sloConfig.perProviderP95Ms.sage_chat as Record<string, number>;
    const modelProviders = sloConfig.modelProviders as Record<string, string>;
    for (const [tag, provider] of Object.entries(modelProviders)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(chatBars, provider),
        `modelProviders["${tag}"] points at "${provider}", which has no bar under sage_chat`,
      );
    }
  });

  it("documents the mapping, since a missing tag degrades silently by design elsewhere", () => {
    assert.ok(sloConfig.notes?.modelProviders, "modelProviders needs a note explaining it");
  });
});
