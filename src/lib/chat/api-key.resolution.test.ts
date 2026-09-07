import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * `resolveApiKey` with the `allowPersonalKey` option (FERPA review, report
 * C2). A student's personal Gemini key is a consumer key outside any
 * program-level agreement, so a student_record / staff_entered prompt must
 * never be sent under it: the resolver skips the personal lookup entirely
 * (no decrypt, no row read) and serves the platform key.
 */

const mockFindUnique = mock.fn<(args: unknown) => Promise<{ geminiApiKey: string | null } | null>>();
const mockDecrypt = mock.fn<(value: string) => string>();
const mockGetConfigValue = mock.fn<(key: string) => Promise<string | null>>();

mock.module("@/lib/db", {
  namedExports: { prisma: { student: { findUnique: mockFindUnique } } },
});
mock.module("@/lib/crypto", {
  namedExports: { decrypt: mockDecrypt, encrypt: (value: string) => value },
});
mock.module("@/lib/system-config", {
  namedExports: { getConfigValue: mockGetConfigValue },
});
mock.module("@/lib/api-error", {
  namedExports: {
    badRequest: (message: string) => Object.assign(new Error(message), { statusCode: 400 }),
  },
});

let resolveApiKey: typeof import("./api-key").resolveApiKey;

before(async () => {
  ({ resolveApiKey } = await import("./api-key"));
});

beforeEach(() => {
  mockFindUnique.mock.resetCalls();
  mockDecrypt.mock.resetCalls();
  mockGetConfigValue.mock.resetCalls();
  mockFindUnique.mock.mockImplementation(async () => ({ geminiApiKey: "encrypted-personal" }));
  mockDecrypt.mock.mockImplementation(() => "personal-key");
  mockGetConfigValue.mock.mockImplementation(async (key) =>
    key === "gemini_api_key" ? "platform-key" : null,
  );
});

describe("resolveApiKey — personal key gate", () => {
  it("default: the personal key still wins (unchanged for existing callers)", async () => {
    assert.equal(await resolveApiKey("student-1"), "personal-key");
    assert.equal(mockFindUnique.mock.callCount(), 1);
    assert.equal(mockDecrypt.mock.callCount(), 1);
  });

  it("allowPersonalKey: true is the same as the default", async () => {
    assert.equal(await resolveApiKey("student-1", { allowPersonalKey: true }), "personal-key");
    assert.equal(mockDecrypt.mock.callCount(), 1);
  });

  it("allowPersonalKey: false serves the platform key and never decrypts the personal one", async () => {
    assert.equal(await resolveApiKey("student-1", { allowPersonalKey: false }), "platform-key");
    assert.equal(mockDecrypt.mock.callCount(), 0, "personal key never decrypted");
    assert.equal(mockFindUnique.mock.callCount(), 0, "personal key row never read");
  });

  it("allowPersonalKey: false falls through to the env key when no platform key is configured", async () => {
    mockGetConfigValue.mock.mockImplementation(async () => null);
    // The env fallback is captured at module load, so this pins the branch
    // order rather than a specific value: no platform key, no personal key
    // → either the env key or the configuration error, never "personal-key".
    let resolved: string | null = null;
    try {
      resolved = await resolveApiKey("student-1", { allowPersonalKey: false });
    } catch (error) {
      assert.match((error as Error).message, /not configured/);
    }
    assert.notEqual(resolved, "personal-key");
    assert.equal(mockDecrypt.mock.callCount(), 0);
  });

  it("a corrupt personal key still fails loudly when personal keys are allowed", async () => {
    mockDecrypt.mock.mockImplementation(() => {
      throw new Error("bad ciphertext");
    });
    await assert.rejects(resolveApiKey("student-1"), /re-entered/);
  });
});
