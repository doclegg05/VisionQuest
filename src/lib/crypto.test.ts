import assert from "node:assert/strict";
import test from "node:test";
import { encrypt, decrypt } from "./crypto";

// Helpers for environment isolation
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const original = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

test("encrypt/decrypt roundtrip produces the original plaintext", () => {
  const plaintext = "super-secret-api-key-12345";

  const ciphertext = encrypt(plaintext);
  const result = decrypt(ciphertext);

  assert.equal(result, plaintext);
});

test("encrypt/decrypt roundtrip works with an empty string", () => {
  const ciphertext = encrypt("");
  assert.equal(decrypt(ciphertext), "");
});

test("encrypt/decrypt roundtrip works with unicode and special characters", () => {
  const plaintext = "Unicode: \u00e9\u00e0\u00fc \u4e2d\u6587 \ud83d\udd11 newline:\nsymbol:$%^&*";

  const ciphertext = encrypt(plaintext);
  const result = decrypt(ciphertext);

  assert.equal(result, plaintext);
});

test("encrypting the same plaintext twice produces different ciphertexts (random IV)", () => {
  const plaintext = "same-input-every-time";

  const first = encrypt(plaintext);
  const second = encrypt(plaintext);

  assert.notEqual(first, second);
});

test("ciphertext has the expected iv:encrypted:authTag format (three colon-separated segments)", () => {
  const ciphertext = encrypt("test-value");

  const parts = ciphertext.split(":");

  assert.equal(parts.length, 3);
  // Each segment must be non-empty base64
  for (const part of parts) {
    assert.ok(part.length > 0, `Segment should not be empty: ${part}`);
  }
});

test("decrypt throws on a tampered ciphertext (modified encrypted payload)", () => {
  const ciphertext = encrypt("original-value");
  const parts = ciphertext.split(":");

  // Corrupt the encrypted payload segment
  const corruptedPayload = Buffer.from(parts[1], "base64");
  corruptedPayload[0] ^= 0xff;
  const tampered = [parts[0], corruptedPayload.toString("base64"), parts[2]].join(":");

  assert.throws(() => decrypt(tampered));
});

test("decrypt throws on a tampered ciphertext (modified auth tag)", () => {
  const ciphertext = encrypt("original-value");
  const parts = ciphertext.split(":");

  // Flip one byte in the auth tag to break authentication
  const corruptedTag = Buffer.from(parts[2], "base64");
  corruptedTag[0] ^= 0xff;
  const tampered = [parts[0], parts[1], corruptedTag.toString("base64")].join(":");

  assert.throws(() => decrypt(tampered));
});

test("decrypt throws on invalid format with no colons", () => {
  assert.throws(
    () => decrypt("notavalidciphertextatall"),
    /Invalid encrypted value format/
  );
});

test("decrypt throws on invalid format with only one colon", () => {
  assert.throws(
    () => decrypt("onepart:twopart"),
    /Invalid encrypted value format/
  );
});

test("decrypt throws on malformed ciphertext with empty segments", () => {
  // "::" has three segments (all empty strings) — passes format guard but fails at crypto layer
  assert.throws(() => decrypt("::"));
});

test("encrypt and decrypt work with the dev fallback key when API_KEY_ENCRYPTION_KEY is not set", () => {
  withEnv("NODE_ENV", "test", () => {
    withEnv("API_KEY_ENCRYPTION_KEY", undefined, () => {
      const plaintext = "value-encrypted-with-dev-key";
      const ciphertext = encrypt(plaintext);
      const result = decrypt(ciphertext);

      assert.equal(result, plaintext);
    });
  });
});

test("getEncryptionKey throws in production when API_KEY_ENCRYPTION_KEY is not set", () => {
  withEnv("NODE_ENV", "production", () => {
    withEnv("API_KEY_ENCRYPTION_KEY", undefined, () => {
      assert.throws(
        () => encrypt("anything"),
        /API_KEY_ENCRYPTION_KEY environment variable is required in production/
      );
    });
  });
});

test("getEncryptionKey throws when API_KEY_ENCRYPTION_KEY is not a 32-byte key", () => {
  // Encode fewer than 32 bytes
  const shortKey = Buffer.from("tooshort").toString("base64");

  withEnv("API_KEY_ENCRYPTION_KEY", shortKey, () => {
    assert.throws(
      () => encrypt("anything"),
      /API_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key/
    );
  });
});
