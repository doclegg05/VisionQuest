import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clamp01,
  coerceManualScores,
  computeHollandCode,
  normalizeOnetScores,
  ONET_MINI_IP_AREA_MAX,
  parseHollandCode,
} from "@/lib/career/formal-riasec";
import { isFormalRiasecLocked, isFormalRiasecSource } from "@/lib/career/riasec-lock";

describe("normalizeOnetScores", () => {
  it("maps Mini-IP max (25) to 1.0", () => {
    const normalized = normalizeOnetScores({
      realistic: ONET_MINI_IP_AREA_MAX,
      investigative: 0,
      artistic: 0,
      social: 0,
      enterprising: 0,
      conventional: 0,
    });
    assert.equal(normalized.realistic, 1);
    assert.equal(normalized.investigative, 0);
  });

  it("scales by observed max when scores exceed Mini-IP max", () => {
    const normalized = normalizeOnetScores({
      realistic: 40,
      investigative: 20,
      artistic: 0,
      social: 0,
      enterprising: 0,
      conventional: 0,
    });
    assert.equal(normalized.realistic, 1);
    assert.equal(normalized.investigative, 0.5);
  });
});

describe("coerceManualScores", () => {
  it("keeps 0..1 scores as normalized", () => {
    const { raw, normalized } = coerceManualScores({
      realistic: 0.8,
      investigative: 0.2,
      artistic: 0,
      social: 0.5,
      enterprising: 0,
      conventional: 0.1,
    });
    assert.equal(raw.realistic, 0.8);
    assert.equal(normalized.realistic, 0.8);
    assert.equal(normalized.social, 0.5);
  });

  it("normalizes integer-scale manual entry", () => {
    const { normalized } = coerceManualScores({
      realistic: 25,
      investigative: 10,
      artistic: 0,
      social: 5,
      enterprising: 0,
      conventional: 0,
    });
    assert.equal(normalized.realistic, 1);
    assert.equal(normalized.investigative, 0.4);
  });
});

describe("computeHollandCode / parseHollandCode", () => {
  it("derives top-three letters", () => {
    assert.equal(
      computeHollandCode({
        realistic: 0.2,
        investigative: 0.9,
        artistic: 0.1,
        social: 0.8,
        enterprising: 0.7,
        conventional: 0,
      }),
      "ISE",
    );
  });

  it("parses optional Holland input", () => {
    assert.equal(parseHollandCode(" sec "), "SEC");
    assert.equal(parseHollandCode("ABCD"), null);
    assert.equal(parseHollandCode(""), null);
  });

  it("clamp01 bounds", () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(0.4), 0.4);
  });
});

describe("isFormalRiasecLocked", () => {
  it("locks formal sources only", () => {
    assert.equal(isFormalRiasecSource("onet_mini_ip"), true);
    assert.equal(isFormalRiasecSource("manual_entry"), true);
    assert.equal(isFormalRiasecSource("sage_chat"), false);
    assert.equal(isFormalRiasecLocked({ riasecSource: "onet_mini_ip" }), true);
    assert.equal(isFormalRiasecLocked({ riasecSource: "sage_chat" }), false);
    assert.equal(isFormalRiasecLocked(null), false);
  });
});
