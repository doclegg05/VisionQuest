import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before, describe, it } from "node:test";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordSafe,
  verifyPasswordSafeWithStatus,
  verifyPasswordWithStatus,
} from "./auth";
import { MAX_CONCURRENT_HASHES } from "./hash-queue";

// Password hashing runs on Node's thread pool, a few at a time, so one
// student's sign-in no longer stops every other request while it is checked.
// Nothing about the hash itself may change with that move: the parameters, the
// stored format, the legacy PBKDF2 check and its rehash signal, the
// constant-time comparison, and the dummy work done for an unknown account.

/**
 * Made with the code as it stood at commit 345bbd0b, before this change, by
 * its synchronous `hashPassword` (scrypt) and by `crypto.pbkdf2Sync` with the
 * legacy parameters. That code verified both. The passwords are made up for
 * this file and belong to no account.
 */
const MADE_BEFORE_THE_CHANGE = {
  scrypt: {
    typed: "fixture made before the async change",
    stored:
      "scrypt$c819fd618359e4322783419093d72b1a4f70ddd5e7eab9c4642f42489c2cc909$99219fc9c06cf592c09e37643fb4bcf1ecef0544ed054ecca837d7f7a374cd584ef00a4d3c01fd925f9100f7ce49f36731a5792d58862f06516b1429d44a93fa",
  },
  pbkdf2: {
    typed: "legacy fixture made before the async change",
    stored:
      "55a5e3d897af45fdad4193d3ae55cf52:91a4d3701b37238a0c64642ad25111e7331574bb8c65e668b2c569f1fbb3e694d81fd5918aa11c3660144d4711ed049ec4f84e11eedcc50e05018a16efdea14d",
  },
} as const;

/** The scrypt parameters every stored hash was made with. Changing one orphans them all. */
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

type ScryptCallback = (error: Error | null, derivedKey: Buffer) => void;

/** Lets every promise callback that is already due run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

before(async () => {
  // The module starts its dummy hash when it loads. Wait for it, so no test
  // below shares the queue with it or counts its work.
  await verifyPasswordSafe("anything", null);
});

describe("the stored format is unchanged", () => {
  it("answers a promise for a scrypt hash in the same three-part form", async () => {
    const pending = hashPassword("correct horse battery staple");
    assert.ok(pending instanceof Promise, "hashPassword must not compute on the calling thread");

    const { hash, salt } = await pending;

    assert.match(hash, /^scrypt\$[0-9a-f]{64}\$[0-9a-f]{128}$/);
    assert.equal(hash.split("$")[1], salt);
  });

  it("derives the same bytes the synchronous form derived, from the same parameters", async () => {
    const typed = "the same bytes either way";
    const { hash, salt } = await hashPassword(typed);

    const expected = crypto.scryptSync(typed, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS).toString("hex");

    assert.equal(hash, `scrypt$${salt}$${expected}`);
  });

  it("gives every hash its own random salt", async () => {
    const [first, second] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);

    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
  });
});

describe("hashes made before the change still verify", () => {
  it("accepts the right password for a scrypt hash, with no rehash asked for", async () => {
    const { typed, stored } = MADE_BEFORE_THE_CHANGE.scrypt;

    assert.deepEqual(await verifyPasswordWithStatus(typed, stored), { valid: true, needsRehash: false });
    assert.equal(await verifyPassword(typed, stored), true);
    assert.deepEqual(await verifyPasswordSafeWithStatus(typed, stored), { valid: true, needsRehash: false });
  });

  it("refuses a wrong password for a scrypt hash", async () => {
    const { stored } = MADE_BEFORE_THE_CHANGE.scrypt;

    assert.deepEqual(await verifyPasswordWithStatus("not the password", stored), { valid: false, needsRehash: false });
    assert.equal(await verifyPassword("not the password", stored), false);
    assert.equal(await verifyPasswordSafe("not the password", stored), false);
  });

  it("accepts the right password for a legacy PBKDF2 hash and asks for the rehash", async () => {
    const { typed, stored } = MADE_BEFORE_THE_CHANGE.pbkdf2;

    assert.deepEqual(await verifyPasswordWithStatus(typed, stored), { valid: true, needsRehash: true });
    assert.deepEqual(await verifyPasswordSafeWithStatus(typed, stored), { valid: true, needsRehash: true });
  });

  it("refuses a wrong password for a legacy PBKDF2 hash and asks for no rehash", async () => {
    const { stored } = MADE_BEFORE_THE_CHANGE.pbkdf2;

    assert.deepEqual(await verifyPasswordWithStatus("not the password", stored), { valid: false, needsRehash: false });
  });

  it("refuses a stored value that is not a hash it knows", async () => {
    for (const stored of ["scrypt$only-two-parts", "scrypt$$", "no-separator-at-all", ":"]) {
      assert.deepEqual(await verifyPasswordWithStatus("anything", stored), { valid: false, needsRehash: false }, stored);
    }
  });
});

describe("the work and its parameters are unchanged", () => {
  it("asks scrypt for the same key length, cost and memory limit", async (t) => {
    const scrypt = t.mock.method(crypto, "scrypt");

    await hashPassword("parameters under test");

    assert.equal(scrypt.mock.callCount(), 1);
    const [, , keyLength, options] = scrypt.mock.calls[0]?.arguments ?? [];
    assert.equal(keyLength, SCRYPT_KEY_LENGTH);
    assert.deepEqual(options, SCRYPT_OPTIONS);
  });

  it("asks PBKDF2 for the same rounds, key length and digest", async (t) => {
    const pbkdf2 = t.mock.method(crypto, "pbkdf2");
    const { typed, stored } = MADE_BEFORE_THE_CHANGE.pbkdf2;

    await verifyPasswordWithStatus(typed, stored);

    assert.equal(pbkdf2.mock.callCount(), 1);
    const [, salt, rounds, keyLength, digest] = pbkdf2.mock.calls[0]?.arguments ?? [];
    assert.equal(salt, stored.split(":")[0]);
    assert.equal(rounds, 100000);
    assert.equal(keyLength, 64);
    assert.equal(digest, "sha512");
  });

  it("compares in constant time, for both formats", async (t) => {
    const compare = t.mock.method(crypto, "timingSafeEqual");

    await verifyPasswordWithStatus("not the password", MADE_BEFORE_THE_CHANGE.scrypt.stored);
    await verifyPasswordWithStatus("not the password", MADE_BEFORE_THE_CHANGE.pbkdf2.stored);

    assert.equal(compare.mock.callCount(), 2);
  });
});

describe("an unknown account still costs one hash", () => {
  it("runs the hash against the dummy and never matches, whatever is stored", async (t) => {
    const scrypt = t.mock.method(crypto, "scrypt");

    for (const stored of [undefined, null, "", "not-a-hash"]) {
      assert.deepEqual(
        await verifyPasswordSafeWithStatus("anything", stored),
        { valid: false, needsRehash: false },
        String(stored),
      );
    }

    // One hash per check: a missing account does the work a wrong password does.
    assert.equal(scrypt.mock.callCount(), 4);
  });

  it("does the same amount of work as a wrong password for a real account", async (t) => {
    const scrypt = t.mock.method(crypto, "scrypt");

    await verifyPasswordSafe("not the password", MADE_BEFORE_THE_CHANGE.scrypt.stored);
    const forRealAccount = scrypt.mock.callCount();
    await verifyPasswordSafe("not the password", null);

    assert.equal(forRealAccount, 1);
    assert.equal(scrypt.mock.callCount() - forRealAccount, 1);
  });

  it("never signs in with the dummy's own password", async () => {
    assert.deepEqual(await verifyPasswordSafeWithStatus("dummy-password-never-matches", null), {
      valid: false,
      needsRehash: false,
    });
  });
});

describe("hashing does not hold the event loop", () => {
  it("never calls the synchronous hash functions", async (t) => {
    const scryptSync = t.mock.method(crypto, "scryptSync");
    const pbkdf2Sync = t.mock.method(crypto, "pbkdf2Sync");

    const { hash } = await hashPassword("off the loop");
    await verifyPasswordWithStatus("off the loop", hash);
    await verifyPasswordWithStatus("anything", MADE_BEFORE_THE_CHANGE.pbkdf2.stored);
    await verifyPasswordSafeWithStatus("anything", null);

    assert.equal(scryptSync.mock.callCount(), 0);
    assert.equal(pbkdf2Sync.mock.callCount(), 0);
  });

  it("lets a timer set before the hash starts fire before the hash finishes", async () => {
    let hashFinished = false;
    const firedWhileHashing = { timer: false, immediate: false };
    const timerFired = new Promise<void>((resolve) => {
      setTimeout(() => {
        firedWhileHashing.timer = !hashFinished;
        resolve();
      }, 0);
    });
    setImmediate(() => {
      firedWhileHashing.immediate = !hashFinished;
    });

    await hashPassword("a hash that takes a while");
    hashFinished = true;
    await timerFired;

    assert.deepEqual(firedWhileHashing, { timer: true, immediate: true });
  });
});

describe("hashes queue instead of all running at once", () => {
  it("starts no more than the limit, and one more for each that finishes", async (t) => {
    const waitingCallbacks: ScryptCallback[] = [];
    let started = 0;
    function heldScrypt(
      _password: crypto.BinaryLike,
      _salt: crypto.BinaryLike,
      _keyLength: number,
      optionsOrCallback: crypto.ScryptOptions | ScryptCallback,
      callback?: ScryptCallback,
    ): void {
      const done = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
      assert.ok(done, "scrypt was called without a callback");
      started += 1;
      waitingCallbacks.push(done);
    }
    t.mock.method(crypto, "scrypt", heldScrypt);
    const finishOne = () => waitingCallbacks.shift()?.(null, Buffer.alloc(SCRYPT_KEY_LENGTH, 7));

    const total = MAX_CONCURRENT_HASHES + 4;
    const pending = Array.from({ length: total }, (_, index) => hashPassword(`sign-in ${index}`));
    await settle();
    assert.equal(started, MAX_CONCURRENT_HASHES, "the rest wait, and allocate nothing yet");

    for (let finished = 1; finished <= total; finished += 1) {
      finishOne();
      await settle();
      assert.equal(started, Math.min(total, MAX_CONCURRENT_HASHES + finished));
    }

    const results = await Promise.all(pending);
    assert.equal(results.length, total);
    assert.equal(waitingCallbacks.length, 0);
  });

  it("puts a verification behind hashes that were asked for first", async (t) => {
    const order: string[] = [];
    const real = crypto.scrypt;
    function recordingScrypt(
      password: crypto.BinaryLike,
      salt: crypto.BinaryLike,
      keyLength: number,
      options: crypto.ScryptOptions,
      callback: ScryptCallback,
    ): void {
      order.push(String(password));
      real(password, salt, keyLength, options, callback);
    }
    t.mock.method(crypto, "scrypt", recordingScrypt);

    const typed = Array.from({ length: MAX_CONCURRENT_HASHES + 2 }, (_, index) => `in line ${index}`);
    await Promise.all(typed.map((password) => verifyPasswordSafe(password, null)));

    assert.deepEqual(order, typed);
  });
});
