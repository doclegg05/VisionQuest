import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO_FIRST_NAMES,
  DEMO_LAST_NAMES,
  makeDemoLogin,
  makeDemoStudentName,
} from "./names";

describe("demo names", () => {
  it("formats name and sequence", () => {
    const sizes: number[] = [];
    const picks = [2, 5];
    const pick = (n: number) => {
      sizes.push(n);
      return picks[sizes.length - 1];
    };

    const name = makeDemoStudentName(7, pick);

    assert.equal(name, `${DEMO_FIRST_NAMES[2]} ${DEMO_LAST_NAMES[5]} 7`);
    assert.deepEqual(sizes, [DEMO_FIRST_NAMES.length, DEMO_LAST_NAMES.length]);
  });

  it("keeps each list at 20 distinct names and never uses the coach's name", () => {
    for (const list of [DEMO_FIRST_NAMES, DEMO_LAST_NAMES]) {
      assert.equal(list.length, 20);
      assert.equal(new Set(list).size, 20);
      for (const name of list) {
        assert.match(name, /^[A-Z][a-z]+$/);
        assert.doesNotMatch(name, /sage/i);
      }
    }
  });

  it("refuses a pick outside the list instead of printing 'undefined'", () => {
    for (const bad of [-1, 20, 1.5, Number.NaN]) {
      assert.throws(() => makeDemoStudentName(1, () => bad), RangeError);
    }
  });

  it("draws from both lists when no pick is given", () => {
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      const [first, last, suffix] = makeDemoStudentName(sequence).split(" ");
      assert.ok(DEMO_FIRST_NAMES.includes(first), `unknown first name ${first}`);
      assert.ok(DEMO_LAST_NAMES.includes(last), `unknown last name ${last}`);
      assert.equal(suffix, String(sequence));
    }
  });

  it("makes a demo- login of 12 hex chars", () => {
    const first = makeDemoLogin();
    const second = makeDemoLogin();

    assert.match(first, /^demo-[0-9a-f]{12}$/);
    assert.match(second, /^demo-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  });
});
