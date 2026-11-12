import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALPHABET,
  PASSWORD_LENGTH_HINT,
  PASSWORD_TOO_SHORT_MESSAGE,
  generatePassword,
} from "./password-policy";

/** Every whole number a piece of copy states. */
function statedNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/gu)].map((match) => Number(match[0]));
}

/** A random source that hands out 0, 1, 2, ... 255, 0, 1, ... across calls. */
function countingBytes(): (count: number) => Uint8Array {
  let next = 0;
  return (count) => Uint8Array.from({ length: count }, () => next++ % 256);
}

describe("the password rule", () => {
  it("is 12 characters (readiness decision R4)", () => {
    assert.equal(MIN_PASSWORD_LENGTH, 12);
  });

  it("builds the on-screen hint from the constant", () => {
    assert.deepEqual(statedNumbers(PASSWORD_LENGTH_HINT), [MIN_PASSWORD_LENGTH]);
  });

  it("builds the too-short error from the constant", () => {
    assert.deepEqual(statedNumbers(PASSWORD_TOO_SHORT_MESSAGE), [MIN_PASSWORD_LENGTH]);
  });

  it("imports nothing, so a client component can use it without pulling in Zod", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/password-policy.ts"), "utf8");
    assert.doesNotMatch(source, /^\s*import\s|\brequire\(/mu);
  });
});

describe("the password alphabet", () => {
  it("holds lowercase letters and digits only, each once", () => {
    assert.match(PASSWORD_ALPHABET, /^[a-z0-9]+$/u);
    assert.equal(new Set(PASSWORD_ALPHABET).size, PASSWORD_ALPHABET.length);
  });

  it("leaves out the characters that look alike", () => {
    for (const lookAlike of "0O1lIo") {
      assert.ok(!PASSWORD_ALPHABET.includes(lookAlike), `"${lookAlike}" is easy to misread`);
    }
  });
});

describe("generatePassword", () => {
  it("makes at least MIN_PASSWORD_LENGTH random characters", () => {
    const randomCharacters = generatePassword().replaceAll("-", "");
    assert.ok(randomCharacters.length >= MIN_PASSWORD_LENGTH, `only ${randomCharacters.length} characters`);
  });

  it("uses only the alphabet", () => {
    for (const character of generatePassword().replaceAll("-", "")) {
      assert.ok(PASSWORD_ALPHABET.includes(character), `"${character}" is not in the alphabet`);
    }
  });

  it("joins groups of four with hyphens so it can be read aloud", () => {
    assert.match(generatePassword(), /^[a-z0-9]{4}(?:-[a-z0-9]{4})+$/u);
  });

  it("makes a different password each time", () => {
    assert.notEqual(generatePassword(), generatePassword());
  });

  it("takes its characters from the injected random source", () => {
    const asked: number[] = [];
    const password = generatePassword((count) => {
      asked.push(count);
      return Uint8Array.from({ length: count }, (_, index) => index);
    });

    assert.equal(password, "abcd-efgh-ijkm");
    assert.deepEqual(asked, [MIN_PASSWORD_LENGTH]);
  });

  it("gives every character the same chance (no modulo bias)", () => {
    const randomBytes = countingBytes();
    const tally = new Map<string, number>();
    let total = 0;
    // 256 passwords use each of the 256 byte values the same number of times.
    for (let call = 0; call < 256; call += 1) {
      for (const character of generatePassword(randomBytes).replaceAll("-", "")) {
        tally.set(character, (tally.get(character) ?? 0) + 1);
        total += 1;
      }
    }

    const expected = total / PASSWORD_ALPHABET.length;
    assert.ok(Number.isInteger(expected), "the alphabet size must divide 256, or the generator needs rejection sampling");
    for (const character of PASSWORD_ALPHABET) {
      assert.equal(tally.get(character), expected, `"${character}" is more or less likely than the rest`);
    }
  });

  it("draws from crypto.getRandomValues by default, never Math.random", (t) => {
    const secure = t.mock.method(globalThis.crypto, "getRandomValues");
    const insecure = t.mock.method(Math, "random");

    generatePassword();

    assert.equal(secure.mock.callCount(), 1);
    assert.equal(insecure.mock.callCount(), 0);
  });
});
